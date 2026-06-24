const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-it-'));
process.env.UPLOAD_DIR = tmpDir;

const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
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
