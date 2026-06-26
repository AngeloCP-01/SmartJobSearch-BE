const { z } = require('zod');
const { ValidationError, AppError } = require('../../shared/utils/errors');
const { generateJson } = require('../analysis/engine/openrouter');

const isUrl = (s) => /^https?:\/\/\S+$/i.test(s.trim());

// Block loopback/private/link-local hosts so a pasted URL can't be used to probe
// the server's internal network (basic SSRF guard).
function assertPublicUrl(url) {
  let host;
  try { host = new URL(url).hostname; } catch { throw new ValidationError('That doesn\'t look like a valid URL.'); }
  const blocked = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|metadata\.|\[?::1\]?$)/i;
  if (blocked.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new ValidationError('That URL is not allowed.');
  }
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

// Best-effort server-side fetch. Many job boards (Indeed/LinkedIn) block bots —
// we surface a clear "paste the text instead" message rather than failing opaquely.
async function fetchPosting(url) {
  assertPublicUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SmartJobSearchCRM/1.0)', Accept: 'text/html' },
    });
    if (!res.ok) throw new ValidationError(`Couldn't fetch that URL (HTTP ${res.status}) — many job sites block automated access. Paste the posting text instead.`);
    const text = htmlToText(await res.text());
    if (text.replace(/\s/g, '').length < 200) {
      throw new ValidationError('That URL didn\'t return readable text (it may need a login or block bots) — paste the posting text instead.');
    }
    return text;
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError('Couldn\'t fetch that URL — paste the posting text instead.');
  } finally {
    clearTimeout(timer);
  }
}

const EXTRACT_SCHEMA = z.object({
  position: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  salaryMin: z.number().nullable().optional(),
  salaryMax: z.number().nullable().optional(),
  workMode: z.enum(['Remote', 'Hybrid', 'OnSite']).nullable().optional(),
  jobDescription: z.string().nullable().optional(),
});

const SYSTEM = [
  'You extract structured fields from a job posting.',
  'Respond with ONLY one minified JSON object — no prose, no markdown fences.',
  'Shape: {"position":string|null,"companyName":string|null,"salaryMin":number|null,"salaryMax":number|null,"workMode":"Remote"|"Hybrid"|"OnSite"|null,"jobDescription":string|null}',
  'position = the job title. companyName = the hiring company (not the job board).',
  'salaryMin/salaryMax = annual figures as plain integers in the posting currency (e.g. "120k" → 120000; if monthly, ×12); null if not stated.',
  'workMode = "Remote" (remote/WFH/work-from-home), "Hybrid", or "OnSite" (on-site/office/in-person); null if not stated.',
  'jobDescription = the responsibilities/requirements text with line breaks preserved; null if none.',
].join(' ');

const toInt = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : null);

async function parsePosting(userId, { content }) {
  if (!process.env.OPENROUTER_API_KEY) throw new AppError('AI is not configured on the server.', 503, 'AI_UNAVAILABLE');

  const raw = content.trim();
  const url = isUrl(raw);
  const text = (url ? await fetchPosting(raw) : raw).slice(0, 18000);
  if (text.replace(/\s/g, '').length < 40) {
    throw new ValidationError('Not enough text to parse — paste the full job posting.');
  }

  let out;
  try {
    ({ data: out } = await generateJson(
      [{ role: 'system', content: SYSTEM }, { role: 'user', content: `JOB POSTING:\n${text}` }],
      EXTRACT_SCHEMA,
    ));
  } catch (err) {
    console.warn(`[postings] AI parse failed (kind=${err.kind || 'unknown'}): ${err.message}`);
    throw new AppError('The AI service is busy right now — please try again in a moment.', 503, 'AI_UNAVAILABLE');
  }

  return {
    position: out.position || '',
    companyName: out.companyName || null,
    salaryMin: toInt(out.salaryMin),
    salaryMax: toInt(out.salaryMax),
    workMode: out.workMode || null,
    // For pasted text, keep exactly what the user copied (formatting intact);
    // for a URL we only have the stripped page text, so use the AI's extraction.
    jobDescription: url ? (out.jobDescription || text) : raw,
    source: url ? raw : null,
  };
}

module.exports = { parsePosting };
