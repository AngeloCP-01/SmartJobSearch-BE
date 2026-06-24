const prisma = require('../../shared/database/prisma');
const storage = require('../../shared/storage');
const { NotFoundError } = require('../../shared/utils/errors');
const { analysisReportSchema } = require('./analysis.schema');
const { extractText } = require('./engine/extract');
const { auditAts } = require('./engine/ats');
const { matchJd } = require('./engine/match');
const { buildSuggestions } = require('./engine/suggestions');
const { tokenize } = require('./engine/text');

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

async function run(userId, { applicationId, documentId }) {
  const application = await prisma.application.findFirst({ where: { id: applicationId, userId } });
  if (!application) throw new NotFoundError('Application not found');
  const document = await prisma.document.findFirst({ where: { id: documentId, userId } });
  if (!document) throw new NotFoundError('Document not found');

  const buffer = await readBuffer(document.storageKey);
  const { text, ok } = await extractText(buffer, document.mimeType);

  const ats = auditAts(text, { mimeType: document.mimeType });
  const jd = application.jobDescription || '';
  const match = ok ? matchJd(text, jd) : null; // no point matching unreadable text
  const meta = {
    documentName: document.name,
    position: application.position ?? null,
    jdPresent: Boolean(jd.trim()),
    extractionOk: ok,
    wordCount: tokenize(text).length,
  };
  const suggestions = buildSuggestions({
    subScores: ats.subScores, sectionFindings: ats.sectionFindings,
    missing: match ? match.missing : [], meta,
  });

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

module.exports = { run, list, getById, remove };
