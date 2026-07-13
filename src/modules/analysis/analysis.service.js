const prisma = require('../../shared/database/prisma');
const storage = require('../../shared/storage');
const { NotFoundError, ValidationError, AppError } = require('../../shared/utils/errors');
const { analysisReportSchema, tailoringResultSchema } = require('./analysis.schema');
const { extractText } = require('./engine/extract');
const { auditAts } = require('./engine/ats');
const { matchJd } = require('./engine/match');
const { buildSuggestions } = require('./engine/suggestions');
const { tokenize } = require('./engine/text');
const { aiMatch, generateTextWithFallback, generateJson } = require('./engine/openrouter');
const { retrieve } = require('../rag/rag.service');

const rowSelect = { id: true, atsScore: true, matchScore: true, report: true, createdAt: true };

function readBuffer(key) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    storage.createReadStream(key)
      .on('data', (c) => chunks.push(c))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject);
  });
}

// Deterministic sweep over generated prose to remove the mechanical "signs of AI
// writing" (from the humanizer skill) that a model still leaks even when the
// prompt forbids them: em/en dashes (§14), emojis (§18), and curly quotes (§19).
// The stylistic tells are handled in the prompt; this guarantees the surface ones.
function humanize(text) {
  if (!text) return text;
  return text
    // numeric ranges: keep "250–350" as a hyphen instead of turning it into "250, 350"
    .replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2')
    // em/en dash and spaced double-hyphen asides -> comma
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+--\s+/g, ', ')
    // curly quotes and apostrophes -> straight
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // emoji and regional-indicator pictographs
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/gu, '')
    // tidy up artifacts the swaps can leave behind
    .replace(/,\s*,/g, ',')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim();
}

async function run(userId, { applicationId, documentId, useAi }) {
  const application = await prisma.application.findFirst({ where: { id: applicationId, userId } });
  if (!application) throw new NotFoundError('Application not found');
  const document = await prisma.document.findFirst({ where: { id: documentId, userId } });
  if (!document) throw new NotFoundError('Document not found');

  const buffer = await readBuffer(document.storageKey);
  const { text, ok } = await extractText(buffer, document.mimeType);

  const ats = auditAts(text, { mimeType: document.mimeType });
  const jd = application.jobDescription || '';

  let match = null;
  let aiUsed = false;
  let aiModel = null;
  let aiSuggestions = null;

  if (ok && jd.trim()) {
    if (useAi && process.env.OPENROUTER_API_KEY) {
      try {
        const r = await aiMatch(text, jd);
        match = { matchScore: r.matchScore, matched: r.matched, missing: r.missing };
        aiSuggestions = r.suggestions;
        aiUsed = true;
        aiModel = r.model;
      } catch (err) {
        // Graceful fallback on any AI failure — but make the reason visible.
        const model = process.env.OPENROUTER_MODEL || 'default';
        console.warn(`[analysis] AI analysis unavailable (kind=${err.kind || 'unknown'}, model=${model}); falling back to deterministic match: ${err.message}`);
        match = matchJd(text, jd);
      }
    } else {
      match = matchJd(text, jd);
    }
  }

  const meta = {
    documentName: document.name,
    position: application.position ?? null,
    jdPresent: Boolean(jd.trim()),
    extractionOk: ok,
    wordCount: tokenize(text).length,
    aiUsed,
    aiModel,
  };

  let suggestions;
  if (aiUsed) {
    // structural (rule) suggestions always run; skill-gap come from the LLM
    const structural = buildSuggestions({ subScores: ats.subScores, sectionFindings: ats.sectionFindings, missing: [], meta });
    const rank = { high: 0, medium: 1, low: 2 };
    suggestions = [...structural, ...aiSuggestions].sort((a, b) => rank[a.severity] - rank[b.severity]);
  } else {
    suggestions = buildSuggestions({
      subScores: ats.subScores, sectionFindings: ats.sectionFindings,
      missing: match ? match.missing : [], meta,
    });
  }

  const report = analysisReportSchema.parse({
    meta,
    atsSubScores: ats.subScores,
    matched: match ? match.matched : [],
    missing: match ? match.missing : [],
    sectionFindings: ats.sectionFindings,
    suggestions,
  });

  return prisma.resumeAnalysis.create({
    data: {
      userId, applicationId, documentId,
      atsScore: ats.atsScore,
      matchScore: match ? match.matchScore : null,
      report,
    },
    select: rowSelect,
  });
}

async function list(userId) {
  const rows = await prisma.resumeAnalysis.findMany({
    where: { userId }, orderBy: { createdAt: 'desc' }, select: rowSelect,
  });
  return rows.map((r) => ({
    id: r.id, atsScore: r.atsScore, matchScore: r.matchScore,
    documentName: r.report?.meta?.documentName ?? null,
    position: r.report?.meta?.position ?? null,
    createdAt: r.createdAt,
  }));
}

async function getById(userId, id) {
  const row = await prisma.resumeAnalysis.findFirst({ where: { id, userId }, select: rowSelect });
  if (!row) throw new NotFoundError('Analysis not found');
  return row;
}

async function remove(userId, id) {
  const row = await prisma.resumeAnalysis.findFirst({ where: { id, userId } });
  if (!row) throw new NotFoundError('Analysis not found');
  await prisma.resumeAnalysis.delete({ where: { id } });
}

// AI-generated, tailored cover letter from an application's job description +
// the chosen résumé's text. Unlike analysis there's no deterministic fallback —
// it's an explicitly AI-only feature — so a saturated provider surfaces a clear
// "try again" rather than silently degrading.
async function generateCoverLetter(userId, { applicationId, documentId }) {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId }, include: { company: true },
  });
  if (!application) throw new NotFoundError('Application not found');
  const document = await prisma.document.findFirst({ where: { id: documentId, userId } });
  if (!document) throw new NotFoundError('Document not found');

  const jd = (application.jobDescription || '').trim();
  if (!jd) throw new ValidationError('This application has no job description — add one to generate a tailored cover letter.');
  if (!process.env.OPENROUTER_API_KEY) throw new AppError('AI is not configured on the server.', 503, 'AI_UNAVAILABLE');

  const buffer = await readBuffer(document.storageKey);
  const { text: resumeText, ok } = await extractText(buffer, document.mimeType);
  if (!ok) throw new ValidationError('Could not read text from that résumé (scanned PDFs and legacy .doc files are not supported).');

  const companyName = application.company?.name || 'the company';
  const position = application.position || 'the role';
  const system = [
    'You are an expert career writer. Write a concise, professional, specific cover letter.',
    'Use ONLY facts supported by the resume. Never invent experience, employers, or metrics.',
    "Open with genuine interest in the role and company, map the candidate's most relevant strengths to the job requirements, and end by proposing a concrete next step, such as a conversation about the role.",
    'About 250 to 350 words across 3 to 4 short paragraphs. Return ONLY the letter body: no preamble, no markdown, no bracketed placeholders.',
    // Humanizer rules (from the "Signs of AI writing" guide) so the letter does not read as machine-generated:
    'Write like a real person, not a chatbot. Do NOT use em dashes or en dashes (use commas, periods, or parentheses instead), emojis, or curly quotes.',
    'Avoid AI-tell vocabulary such as: passionate, thrilled, excited, delve, leverage, robust, dynamic, vibrant, seamless, tapestry, testament, showcase, foster, honed, spearheaded, elevate, resonate.',
    'Avoid promotional filler and generic upbeat closings such as "I would be a great fit", "exciting opportunity", or "take my career to the next level". Do not force ideas into groups of three, and avoid "not only... but also" constructions.',
    'Prefer plain verbs (is, has, did) over inflated ones, vary sentence length, and stay specific and grounded in the resume rather than effusive.',
  ].join(' ');
  const user = `COMPANY: ${companyName}\nROLE: ${position}\n\nJOB DESCRIPTION:\n${jd}\n\nCANDIDATE RÉSUMÉ:\n${resumeText}`;

  let result;
  try {
    result = await generateTextWithFallback([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
  } catch (err) {
    console.warn(`[cover-letter] AI generation failed (kind=${err.kind || 'unknown'}): ${err.message}`);
    throw new AppError('The AI service is busy right now — please try again in a moment.', 503, 'AI_UNAVAILABLE');
  }

  return {
    coverLetter: humanize(result.text),
    meta: { companyName, position, documentName: document.name, model: result.model },
  };
}

// AI-generated résumé tailoring suggestions, grounded in the user's real
// documents via RAG. Retrieves the most JD-relevant chunks across the whole
// corpus, feeds them as evidence, and enforces no-fabrication: an "add" that
// isn't cited to a retrieved document is dropped server-side. Ephemeral like
// the cover letter — nothing is stored.
async function generateTailoringSuggestions(userId, { applicationId, documentId }) {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId }, include: { company: true },
  });
  if (!application) throw new NotFoundError('Application not found');
  const document = await prisma.document.findFirst({ where: { id: documentId, userId } });
  if (!document) throw new NotFoundError('Document not found');

  const jd = (application.jobDescription || '').trim();
  if (!jd) throw new ValidationError('This application has no job description — add one to get tailoring suggestions.');
  if (!process.env.OPENROUTER_API_KEY) throw new AppError('AI is not configured on the server.', 503, 'AI_UNAVAILABLE');

  const buffer = await readBuffer(document.storageKey);
  const { text: resumeText, ok } = await extractText(buffer, document.mimeType);
  if (!ok) throw new ValidationError('Could not read text from that résumé (scanned PDFs and legacy .doc files are not supported).');

  // RAG grounding: most JD-relevant chunks across ALL the user's documents.
  let chunks;
  try {
    chunks = await retrieve(userId, jd, { topK: 8 });
  } catch (err) {
    console.warn(`[tailor] retrieval failed (kind=${err.kind || 'unknown'}): ${err.message}`);
    throw new AppError('Could not build tailoring suggestions right now — please try again in a moment.', 503, 'AI_UNAVAILABLE');
  }
  const docs = await prisma.document.findMany({ where: { userId }, select: { id: true, name: true } });
  const nameById = new Map(docs.map((d) => [d.id, d.name]));
  const evidence = chunks.map((c) => ({ name: nameById.get(c.documentId) || 'a document', content: c.content }));
  // Only REAL document names gate the no-fabrication backstop — never the display placeholder.
  const sourceNames = new Set(
    chunks.map((c) => nameById.get(c.documentId)).filter(Boolean).map((n) => n.trim().toLowerCase()),
  );
  const evidenceBlock = evidence.length
    ? evidence.map((e) => `[from: ${e.name}] ${e.content}`).join('\n')
    : 'none';

  const companyName = application.company?.name || 'the company';
  const position = application.position || 'the role';
  const system = [
    'You are an expert résumé coach. You suggest concrete edits to make a résumé fit a specific job.',
    'You NEVER invent experience, skills, employers, dates, or metrics.',
    'You may only suggest ADDING something (kind "add") if it appears in the GROUNDED EVIDENCE below. Every "add" MUST set groundedIn to the exact document name it came from. If the evidence does not support a job requirement, say nothing about it — do not fabricate to fill a gap.',
    'kind "emphasize", "rephrase", and "remove" operate only on the CURRENT RÉSUMÉ; set their groundedIn to "this résumé".',
    'For "emphasize", "rephrase", and "remove", also set "anchor" to a SHORT snippet (under ~10 words, on ONE line) copied VERBATIM from the CURRENT RÉSUMÉ that the edit targets, so it can be located in the text. For "add", set "anchor" to an empty string.',
    'severity is "high" for gaps that clearly cost the candidate the match, "medium" for meaningful improvements, "low" for polish.',
    'Return at most 12 suggestions, most important first.',
    // Explicit output contract — without the exact shape, models omit fields
    // (commonly "why") or return markdown prose instead of JSON.
    'Return ONLY one minified JSON object, with no markdown, code fences, or commentary, of exactly this shape: {"suggestions":[{"kind":"add|emphasize|rephrase|remove","text":"the concrete edit","why":"one sentence on why it matters for THIS job","groundedIn":"a document name, or the words this résumé","anchor":"a verbatim snippet from the current résumé, or empty string for add","severity":"high|medium|low"}]}.',
    'Every suggestion object MUST include all six fields: kind, text, why, groundedIn, anchor, severity. Never omit "why".',
    // Humanizer rules (from the "Signs of AI writing" guide):
    'Write like a real person. Do NOT use em dashes or en dashes (use commas, periods, or parentheses), emojis, or curly quotes.',
    'Avoid AI-tell vocabulary such as: passionate, thrilled, excited, delve, leverage, robust, dynamic, seamless, spearheaded, elevate, resonate. Prefer plain verbs.',
  ].join(' ');
  const user = `JOB DESCRIPTION:\n${jd}\n\nCURRENT RÉSUMÉ:\n${resumeText}\n\nGROUNDED EVIDENCE (real content from your documents):\n${evidenceBlock}`;

  let result;
  try {
    result = await generateJson([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], tailoringResultSchema);
  } catch (err) {
    console.warn(`[tailor] AI generation failed (kind=${err.kind || 'unknown'}): ${err.message}`);
    throw new AppError('The AI service is busy right now — please try again in a moment.', 503, 'AI_UNAVAILABLE');
  }

  const rank = { high: 0, medium: 1, low: 2 };
  const suggestions = result.data.suggestions
    // No-fabrication backstop: an "add" must cite a real retrieved document.
    .filter((s) => s.kind !== 'add' || sourceNames.has((s.groundedIn || '').trim().toLowerCase()))
    .map((s) => ({ ...s, text: humanize(s.text), why: humanize(s.why) }))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    suggestions,
    meta: { companyName, position, documentName: document.name, model: result.model, evidenceCount: evidence.length },
  };
}

function config() {
  return { aiAvailable: Boolean(process.env.OPENROUTER_API_KEY) };
}

module.exports = { run, generateCoverLetter, generateTailoringSuggestions, list, getById, remove, config };
