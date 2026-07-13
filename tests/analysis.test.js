const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-it-'));
process.env.UPLOAD_DIR = tmpDir;

jest.mock('../src/modules/analysis/engine/openrouter');
const { aiMatch, generateTextWithFallback, generateJson } = require('../src/modules/analysis/engine/openrouter');

jest.mock('../src/modules/rag/rag.service');
const { retrieve, indexDocument } = require('../src/modules/rag/rag.service');

const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
beforeEach(() => { indexDocument.mockResolvedValue({ chunks: 0 }); });
// Guarantee no OPENROUTER_API_KEY leaks between tests even if one fails mid-way.
afterEach(() => { delete process.env.OPENROUTER_API_KEY; });
afterAll(async () => { await prisma.$disconnect(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const resumeDocx = () => fs.readFileSync(path.join(__dirname, 'fixtures/resume.docx'));

async function uploadResume(token) {
  return (await agent().post('/api/documents').set(auth(token))
    .field('name', 'My Resume').field('type', 'Resume')
    .attach('file', resumeDocx(), { filename: 'resume.docx', contentType: DOCX })).body.id;
}
async function makeApp(token, jobDescription) {
  return (await agent().post('/api/applications').set(auth(token))
    .send({ position: 'Backend Engineer', jobDescription })).body.id;
}

test('requires authentication (401)', async () => {
  expect((await agent().get('/api/analysis')).status).toBe(401);
});

test('runs an analysis with a JD → scores + valid report; lists + fetches + deletes it', async () => {
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'Backend Engineer skilled in Node.js, PostgreSQL, Docker and Kubernetes. Good communication.');
  const docId = await uploadResume(token);

  const run = await agent().post('/api/analysis').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(run.status).toBe(201);
  expect(run.body.atsScore).toBeGreaterThan(0);
  expect(typeof run.body.matchScore).toBe('number');
  expect(run.body.report.matched.length + run.body.report.missing.length).toBeGreaterThan(0);
  expect(run.body.report.meta.extractionOk).toBe(true);

  const list = await agent().get('/api/analysis').set(auth(token));
  expect(list.body).toHaveLength(1);
  expect(list.body[0]).toMatchObject({ id: run.body.id, documentName: 'My Resume', position: 'Backend Engineer' });

  const one = await agent().get(`/api/analysis/${run.body.id}`).set(auth(token));
  expect(one.body.report.suggestions.length).toBeGreaterThanOrEqual(0);

  expect((await agent().delete(`/api/analysis/${run.body.id}`).set(auth(token))).status).toBe(204);
  expect((await agent().get('/api/analysis').set(auth(token))).body).toHaveLength(0);
});

test('an application without a JD → matchScore null but a full ATS audit', async () => {
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, undefined);
  const docId = await uploadResume(token);
  const run = await agent().post('/api/analysis').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(run.status).toBe(201);
  expect(run.body.matchScore).toBeNull();
  expect(run.body.report.meta.jdPresent).toBe(false);
  expect(run.body.atsScore).toBeGreaterThan(0);
});

test('an unparseable résumé → 201 with a parseability-failure report (not 500)', async () => {
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'Node.js role');
  const docId = (await agent().post('/api/documents').set(auth(token))
    .field('name', 'Scan').field('type', 'Resume')
    .attach('file', Buffer.from('%PDF-1.4 not real text'), { filename: 's.pdf', contentType: 'application/pdf' })).body.id;
  const run = await agent().post('/api/analysis').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(run.status).toBe(201);
  expect(run.body.report.meta.extractionOk).toBe(false);
  expect(run.body.report.suggestions[0].severity).toBe('high');
});

test('cross-user isolation (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const appId = await makeApp(a.token, 'Node.js');
  const docId = await uploadResume(a.token);
  expect((await agent().post('/api/analysis').set(auth(b.token)).send({ applicationId: appId, documentId: docId })).status).toBe(404);
  const run = await agent().post('/api/analysis').set(auth(a.token)).send({ applicationId: appId, documentId: docId });
  expect((await agent().get(`/api/analysis/${run.body.id}`).set(auth(b.token))).status).toBe(404);
  expect((await agent().delete(`/api/analysis/${run.body.id}`).set(auth(b.token))).status).toBe(404);
});

const AI_RESULT = {
  matchScore: 80,
  matched: [{ term: 'rust', type: 'hard', jdCount: 1, resumeCount: 1, weight: 4 }],
  missing: [{ term: 'elixir', type: 'hard', jdCount: 1, resumeCount: 0, weight: 4 }],
  suggestions: [{ text: 'Add Elixir if you have it.', severity: 'high', source: 'ai' }],
  model: 'test/model:free',
};

test('useAi + key + AI success → aiUsed true with AI match + ai suggestions', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  aiMatch.mockResolvedValue(AI_RESULT);
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'We need Rust and Elixir.');
  const docId = await uploadResume(token);
  const run = await agent().post('/api/analysis').set(auth(token)).send({ applicationId: appId, documentId: docId, useAi: true });
  expect(run.status).toBe(201);
  expect(run.body.report.meta.aiUsed).toBe(true);
  expect(run.body.report.meta.aiModel).toBe('test/model:free');
  expect(run.body.report.matched.map((e) => e.term)).toContain('rust');
  expect(run.body.report.suggestions.some((s) => s.source === 'ai')).toBe(true);
  delete process.env.OPENROUTER_API_KEY;
});

test('useAi + key + AI throws → falls back to deterministic (never 500)', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  aiMatch.mockRejectedValue(new Error('rate limited'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const { token } = await registerAndLogin();
    const appId = await makeApp(token, 'Node.js and PostgreSQL.');
    const docId = await uploadResume(token);
    const run = await agent().post('/api/analysis').set(auth(token)).send({ applicationId: appId, documentId: docId, useAi: true });
    expect(run.status).toBe(201);
    expect(run.body.report.meta.aiUsed).toBe(false);
    expect(typeof run.body.matchScore).toBe('number');
  } finally {
    warn.mockRestore();
    delete process.env.OPENROUTER_API_KEY;
  }
});

test('useAi + key + AI throws → logs a diagnostic warning before falling back', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  const aiErr = Object.assign(new Error('OpenRouter request failed: 429 — rate limit exceeded'), { kind: 'http', status: 429 });
  aiMatch.mockRejectedValue(aiErr);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const { token } = await registerAndLogin();
    const appId = await makeApp(token, 'Node.js and PostgreSQL.');
    const docId = await uploadResume(token);
    const run = await agent().post('/api/analysis').set(auth(token)).send({ applicationId: appId, documentId: docId, useAi: true });
    expect(run.status).toBe(201);
    expect(warn).toHaveBeenCalled();
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('429');
    expect(logged).toMatch(/AI|OpenRouter|fall/i);
  } finally {
    warn.mockRestore();
    delete process.env.OPENROUTER_API_KEY;
  }
});

test('useAi + NO key → deterministic, AI never attempted', async () => {
  delete process.env.OPENROUTER_API_KEY;
  aiMatch.mockReset();
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'Node.js role.');
  const docId = await uploadResume(token);
  const run = await agent().post('/api/analysis').set(auth(token)).send({ applicationId: appId, documentId: docId, useAi: true });
  expect(run.status).toBe(201);
  expect(run.body.report.meta.aiUsed).toBe(false);
  expect(aiMatch).not.toHaveBeenCalled();
});

// --- AI cover-letter generator ---

test('generates a cover letter from a JD + résumé when AI is available', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateTextWithFallback.mockReset();
  generateTextWithFallback.mockResolvedValue({ text: 'Dear Hiring Team, I am excited to apply…', model: 'test/model:free' });
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'We need Rust and Elixir and good communication.');
  const docId = await uploadResume(token);
  const res = await agent().post('/api/analysis/cover-letter').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(201);
  expect(res.body.coverLetter).toContain('Dear Hiring Team');
  expect(res.body.meta).toMatchObject({ position: 'Backend Engineer', documentName: 'My Resume', model: 'test/model:free' });
  delete process.env.OPENROUTER_API_KEY;
});

test('cover letter is humanized: em dashes, curly quotes, and emojis are stripped from AI output', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateTextWithFallback.mockReset();
  generateTextWithFallback.mockResolvedValue({
    text: 'Dear Hiring Team — I am “thrilled” 🚀 to apply for this 250–350 word role.',
    model: 'test/model:free',
  });
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'We need Rust and Elixir and good communication.');
  const docId = await uploadResume(token);
  const res = await agent().post('/api/analysis/cover-letter').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(201);
  const letter = res.body.coverLetter;
  expect(letter).not.toMatch(/[—–“”‘’]/);
  expect(letter).not.toMatch(/\p{Extended_Pictographic}/u);
  expect(letter).toContain('"thrilled"');
  expect(letter).toContain('250-350'); // numeric range kept as a hyphen, not split
  delete process.env.OPENROUTER_API_KEY;
});

test('cover letter requires a job description (400)', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, undefined);
  const docId = await uploadResume(token);
  const res = await agent().post('/api/analysis/cover-letter').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(400);
  delete process.env.OPENROUTER_API_KEY;
});

test('cover letter needs AI configured → 503, never calls the model, when no key', async () => {
  delete process.env.OPENROUTER_API_KEY;
  generateTextWithFallback.mockReset();
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'Node.js role with REST APIs.');
  const docId = await uploadResume(token);
  const res = await agent().post('/api/analysis/cover-letter').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(503);
  expect(generateTextWithFallback).not.toHaveBeenCalled();
});

test('cover letter surfaces a friendly 503 when the AI service fails', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateTextWithFallback.mockReset();
  generateTextWithFallback.mockRejectedValue(Object.assign(new Error('429 rate limited'), { kind: 'http', status: 429 }));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const { token } = await registerAndLogin();
    const appId = await makeApp(token, 'Node.js and PostgreSQL.');
    const docId = await uploadResume(token);
    const res = await agent().post('/api/analysis/cover-letter').set(auth(token)).send({ applicationId: appId, documentId: docId });
    expect(res.status).toBe(503);
  } finally {
    warn.mockRestore();
    delete process.env.OPENROUTER_API_KEY;
  }
});

test('GET /api/analysis/config reflects the API key presence', async () => {
  const { token } = await registerAndLogin();
  process.env.OPENROUTER_API_KEY = 'k';
  expect((await agent().get('/api/analysis/config').set(auth(token))).body).toEqual({ aiAvailable: true });
  delete process.env.OPENROUTER_API_KEY;
  expect((await agent().get('/api/analysis/config').set(auth(token))).body).toEqual({ aiAvailable: false });
  expect((await agent().get('/api/analysis/config')).status).toBe(401);
});

// --- AI résumé tailoring (RAG-grounded) ---

test('tailor returns grounded suggestions and calls retrieve with the JD', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateJson.mockReset();
  retrieve.mockReset();
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'We need Kafka streaming and PostgreSQL.');
  const docId = await uploadResume(token);

  retrieve.mockResolvedValue([{ documentId: docId, content: 'Built Kafka streaming pipelines at scale.', similarity: 0.9 }]);
  generateJson.mockResolvedValue({
    model: 'test/model:free',
    data: { suggestions: [
      { kind: 'add', text: 'Add your Kafka pipeline work — 250 events/s.', why: 'The JD calls for Kafka streaming.', groundedIn: 'My Resume', severity: 'high' },
      { kind: 'emphasize', text: 'Move PostgreSQL higher.', why: 'Listed as required.', groundedIn: 'this résumé', severity: 'medium' },
    ] },
  });

  const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(201);
  expect(retrieve).toHaveBeenCalledWith(expect.any(String), 'We need Kafka streaming and PostgreSQL.', { topK: 8 });
  expect(res.body.suggestions).toHaveLength(2);
  expect(res.body.suggestions[0]).toMatchObject({ kind: 'add', groundedIn: 'My Resume', severity: 'high' });
  expect(res.body.meta).toMatchObject({ position: 'Backend Engineer', documentName: 'My Resume', model: 'test/model:free', evidenceCount: 1 });
  delete process.env.OPENROUTER_API_KEY;
});

test('tailor returns the verbatim anchor per suggestion (add anchor is empty)', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateJson.mockReset();
  retrieve.mockReset();
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'We need PostgreSQL.');
  const docId = await uploadResume(token);

  retrieve.mockResolvedValue([{ documentId: docId, content: 'x', similarity: 0.9 }]);
  generateJson.mockResolvedValue({
    model: 'test/model:free',
    data: { suggestions: [
      { kind: 'rephrase', text: 'Use "architected" instead of "built".', why: 'Stronger verb.', groundedIn: 'this résumé', anchor: 'built REST APIs', severity: 'low' },
      { kind: 'add', text: 'Mention Docker.', why: 'The JD asks for it.', groundedIn: 'My Resume', anchor: '', severity: 'high' },
    ] },
  });

  const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(201);
  const byKind = Object.fromEntries(res.body.suggestions.map((s) => [s.kind, s]));
  expect(byKind.rephrase.anchor).toBe('built REST APIs'); // verbatim, not humanized
  expect(byKind.add.anchor).toBe('');
  delete process.env.OPENROUTER_API_KEY;
});

test('tailor drops an "add" suggestion not grounded in a retrieved document (no fabrication)', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateJson.mockReset();
  retrieve.mockReset();
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'We need Rust.');
  const docId = await uploadResume(token);

  retrieve.mockResolvedValue([{ documentId: docId, content: 'Node.js and PostgreSQL experience.', similarity: 0.8 }]);
  generateJson.mockResolvedValue({
    model: 'test/model:free',
    data: { suggestions: [
      { kind: 'add', text: 'Add Rust systems programming.', why: 'JD wants Rust.', groundedIn: 'Ghostwriter.pdf', severity: 'high' },
      { kind: 'emphasize', text: 'Emphasize PostgreSQL.', why: 'Adjacent skill.', groundedIn: 'this résumé', severity: 'low' },
    ] },
  });

  const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(201);
  // The fabricated "add" (grounded in a document that was never retrieved) is removed.
  expect(res.body.suggestions).toHaveLength(1);
  expect(res.body.suggestions[0].kind).toBe('emphasize');
  delete process.env.OPENROUTER_API_KEY;
});

test('tailor does not let the display placeholder ("a document") bypass the no-fabrication filter', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateJson.mockReset();
  retrieve.mockReset();
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'We need Go.');
  const docId = await uploadResume(token);
  // Retrieved chunk points at a documentId with no matching Document row (orphaned) →
  // its display name is the "a document" placeholder, which must NOT gate the backstop.
  retrieve.mockResolvedValue([{ documentId: '00000000-0000-0000-0000-000000000000', content: 'Go microservices.', similarity: 0.7 }]);
  generateJson.mockResolvedValue({
    model: 'test/model:free',
    data: { suggestions: [
      { kind: 'add', text: 'Add Go microservices.', why: 'JD wants Go.', groundedIn: 'a document', severity: 'high' },
      { kind: 'emphasize', text: 'Emphasize backend work.', why: 'Adjacent.', groundedIn: 'this résumé', severity: 'low' },
    ] },
  });
  const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(201);
  expect(res.body.suggestions).toHaveLength(1);
  expect(res.body.suggestions[0].kind).toBe('emphasize');
  delete process.env.OPENROUTER_API_KEY;
});

test('tailor still returns suggestions when retrieval is empty', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateJson.mockReset();
  retrieve.mockReset();
  retrieve.mockResolvedValue([]);
  generateJson.mockResolvedValue({
    model: 'test/model:free',
    data: { suggestions: [{ kind: 'rephrase', text: 'Lead with impact verbs.', why: 'Reads passively.', groundedIn: 'this résumé', severity: 'medium' }] },
  });
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'Node.js role.');
  const docId = await uploadResume(token);
  const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(201);
  expect(res.body.suggestions).toHaveLength(1);
  expect(res.body.meta.evidenceCount).toBe(0);
  delete process.env.OPENROUTER_API_KEY;
});

test('tailor requires a job description (400)', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, undefined);
  const docId = await uploadResume(token);
  const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(400);
  delete process.env.OPENROUTER_API_KEY;
});

test('tailor needs AI configured → 503, never calls the model, when no key', async () => {
  delete process.env.OPENROUTER_API_KEY;
  generateJson.mockReset();
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'Node.js role.');
  const docId = await uploadResume(token);
  const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(503);
  expect(generateJson).not.toHaveBeenCalled();
});

test('tailor surfaces a friendly 503 when the AI service fails', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateJson.mockReset();
  retrieve.mockReset();
  retrieve.mockResolvedValue([]);
  generateJson.mockRejectedValue(Object.assign(new Error('429 rate limited'), { kind: 'http', status: 429 }));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const { token } = await registerAndLogin();
    const appId = await makeApp(token, 'Node.js and PostgreSQL.');
    const docId = await uploadResume(token);
    const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
    expect(res.status).toBe(503);
  } finally {
    warn.mockRestore();
    delete process.env.OPENROUTER_API_KEY;
  }
});

test('tailor surfaces a friendly 503 when RAG retrieval fails', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateJson.mockReset();
  retrieve.mockReset();
  retrieve.mockRejectedValue(Object.assign(new Error('pgvector down'), { kind: 'db' }));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const { token } = await registerAndLogin();
    const appId = await makeApp(token, 'Node.js and PostgreSQL.');
    const docId = await uploadResume(token);
    const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
    expect(res.status).toBe(503);
    expect(generateJson).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
    delete process.env.OPENROUTER_API_KEY;
  }
});
