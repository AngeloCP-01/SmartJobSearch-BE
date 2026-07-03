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
  const res = await upload(token, { buf: Buffer.from('PNGDATA'), filename: 'photo.png', contentType: 'image/png' });
  expect(res.status).toBe(400);
});

test('accepts a .txt upload (e.g. a saved cover letter)', async () => {
  const { token } = await registerAndLogin();
  const res = await upload(token, {
    name: 'Cover Letter', type: 'CoverLetter',
    buf: Buffer.from('Dear Hiring Team, …'), filename: 'cover.txt', contentType: 'text/plain',
  });
  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ name: 'Cover Letter', type: 'CoverLetter', mimeType: 'text/plain' });
});

test('accepts a markdown upload', async () => {
  const { token } = await registerAndLogin();
  const res = await upload(token, {
    name: 'Notes', type: 'Other',
    buf: Buffer.from('# Notes\n\nsome content'), filename: 'notes.md', contentType: 'text/markdown',
  });
  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ mimeType: 'text/markdown' });
});

test('GET /:id/text returns kind:text raw content for a markdown document', async () => {
  const { token } = await registerAndLogin();
  const created = await upload(token, {
    name: 'Notes', type: 'Other',
    buf: Buffer.from('# Backend Engineer\n\nNode.js and PostgreSQL experience.'),
    filename: 'notes.md', contentType: 'text/markdown',
  });
  const res = await agent().get(`/api/documents/${created.body.id}/text`).set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.kind).toBe('text');
  expect(res.body.content).toContain('# Backend Engineer');
});

test('GET /:id/text returns kind:html with structure for a DOCX document', async () => {
  const { token } = await registerAndLogin();
  const created = await upload(token, {
    name: 'Resume', type: 'Resume',
    buf: fs.readFileSync(path.join(__dirname, 'fixtures/resume.docx')),
    filename: 'resume.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const res = await agent().get(`/api/documents/${created.body.id}/text`).set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.kind).toBe('html');
  expect(res.body.content).toMatch(/<(p|ul|li|strong|h[1-6])\b/i); // formatting preserved, not a flat wall of text
});

test('GET /:id/text returns ok:false for an unparseable document', async () => {
  const { token } = await registerAndLogin();
  const created = await upload(token); // the fake PDF buffer can't be parsed
  const res = await agent().get(`/api/documents/${created.body.id}/text`).set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(false);
  expect(res.body.content).toBe('');
});

test('GET /:id/text is 404 for another user\'s document', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const created = await upload(a.token, { buf: Buffer.from('# x\n\ncontent here'), filename: 'x.md', contentType: 'text/markdown' });
  const res = await agent().get(`/api/documents/${created.body.id}/text`).set(auth(b.token));
  expect(res.status).toBe(404);
});

test('GET /:id/text requires authentication (401)', async () => {
  const res = await agent().get('/api/documents/some-id/text');
  expect(res.status).toBe(401);
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

test('downloads the stored bytes with the right content-type', async () => {
  const { token } = await registerAndLogin();
  const created = await upload(token, { filename: 'cv.pdf' });
  const res = await agent().get(`/api/documents/${created.body.id}/file`).set(auth(token)).buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(Buffer.from(c, 'binary')));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('application/pdf');
  expect(Buffer.from(res.body).equals(PDF)).toBe(true);
});

test('updates document metadata', async () => {
  const { token } = await registerAndLogin();
  const created = await upload(token, { name: 'Old', type: 'Resume' });
  const patched = await agent().patch(`/api/documents/${created.body.id}`).set(auth(token))
    .send({ name: 'New Name', type: 'CoverLetter', notes: 'updated' });
  expect(patched.status).toBe(200);
  expect(patched.body).toMatchObject({ name: 'New Name', type: 'CoverLetter', notes: 'updated' });
});

test('deletes a document and removes its file', async () => {
  const { token } = await registerAndLogin();
  const created = await upload(token);
  const del = await agent().delete(`/api/documents/${created.body.id}`).set(auth(token));
  expect(del.status).toBe(204);
  const list = await agent().get('/api/documents').set(auth(token));
  expect(list.body).toHaveLength(0);
  const dl = await agent().get(`/api/documents/${created.body.id}/file`).set(auth(token));
  expect(dl.status).toBe(404);
});

test('downloading a document whose file is missing fails cleanly (no crash)', async () => {
  const { token } = await registerAndLogin();
  const created = await upload(token);
  // Simulate the blob being lost while the DB record remains.
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const res = await agent().get(`/api/documents/${created.body.id}/file`).set(auth(token));
  expect(res.status).toBeGreaterThanOrEqual(400);
});

test('a user cannot read, download, update, or delete another user\'s document (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const created = await upload(a.token);
  const id = created.body.id;
  expect((await agent().get(`/api/documents/${id}/file`).set(auth(b.token))).status).toBe(404);
  expect((await agent().patch(`/api/documents/${id}`).set(auth(b.token)).send({ name: 'X' })).status).toBe(404);
  expect((await agent().delete(`/api/documents/${id}`).set(auth(b.token))).status).toBe(404);
});
