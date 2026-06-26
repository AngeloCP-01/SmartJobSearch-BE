const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-it-'));
process.env.UPLOAD_DIR = tmpDir;

jest.mock('../src/modules/analysis/engine/openrouter');
const { aiMatch, generateTextWithFallback } = require('../src/modules/analysis/engine/openrouter');

const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
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
