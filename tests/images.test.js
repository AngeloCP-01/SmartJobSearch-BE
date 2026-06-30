const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-it-'));
process.env.UPLOAD_DIR = tmpDir;

const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('uploads an image and returns an absolute serve url', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/images').set(auth(token))
    .attach('file', PNG, { filename: 'sig.png', contentType: 'image/png' });
  expect(res.status).toBe(201);
  expect(res.body.id).toBeTruthy();
  expect(res.body.url).toMatch(new RegExp(`/images/${res.body.id}$`));
  expect(res.body.storageKey).toBeUndefined();
});

test('requires auth to upload (401)', async () => {
  const res = await agent().post('/api/images')
    .attach('file', PNG, { filename: 'sig.png', contentType: 'image/png' });
  expect(res.status).toBe(401);
});

test('rejects a non-image type (400)', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/images').set(auth(token))
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'x.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(400);
});

test('serves the image bytes publicly (no auth) with the right content-type', async () => {
  const { token } = await registerAndLogin();
  const up = await agent().post('/api/images').set(auth(token))
    .attach('file', PNG, { filename: 'sig.png', contentType: 'image/png' });
  const res = await agent().get(`/api/images/${up.body.id}`); // no auth header
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('image/png');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(Buffer.from(res.body).equals(PNG)).toBe(true);
});

test('returns 404 for an unknown image id', async () => {
  const res = await agent().get('/api/images/00000000-0000-0000-0000-000000000000');
  expect(res.status).toBe(404);
});
