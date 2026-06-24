const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-it-'));
process.env.UPLOAD_DIR = tmpDir;

const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const PDF = Buffer.from('%PDF-1.4 fake pdf');

const upload = (token, { name = 'Resume', type = 'Resume', notes, buf = PDF, filename = 'resume.pdf', contentType = 'application/pdf' } = {}) => {
  let req = agent().post('/api/documents').set(auth(token))
    .field('name', name).field('type', type);
  if (notes !== undefined) req = req.field('notes', notes);
  return req.attach('file', buf, { filename, contentType });
};

test('requires authentication (401)', async () => {
  const res = await agent().get('/api/documents');
  expect(res.status).toBe(401);
});

test('uploads a document and lists it', async () => {
  const { token } = await registerAndLogin();
  const created = await upload(token, { name: 'Backend Resume v2', type: 'Resume', notes: 'tailored' });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({
    name: 'Backend Resume v2', type: 'Resume', notes: 'tailored',
    originalFilename: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length,
  });
  expect(created.body.storageKey).toBeUndefined();
  expect(created.body.userId).toBeUndefined();

  const list = await agent().get('/api/documents').set(auth(token));
  expect(list.status).toBe(200);
  expect(list.body).toHaveLength(1);
  expect(list.body[0].name).toBe('Backend Resume v2');
});

test('rejects a disallowed file type (400)', async () => {
  const { token } = await registerAndLogin();
  const res = await upload(token, { buf: Buffer.from('hi'), filename: 'note.txt', contentType: 'text/plain' });
  expect(res.status).toBe(400);
});

test('rejects a file over 5MB (400)', async () => {
  const { token } = await registerAndLogin();
  const big = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
  const res = await upload(token, { buf: big });
  expect(res.status).toBe(400);
});

test('rejects a missing file (400)', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/documents').set(auth(token)).field('name', 'X').field('type', 'Resume');
  expect(res.status).toBe(400);
});
