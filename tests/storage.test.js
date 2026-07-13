const fs = require('fs');
const os = require('os');
const path = require('path');

let storage;
let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docstore-'));
  process.env.UPLOAD_DIR = tmpDir;
  storage = require('../src/shared/storage');
});

afterAll(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

const read = (stream) => new Promise((resolve, reject) => {
  const chunks = [];
  stream.on('data', (c) => chunks.push(c));
  stream.on('end', () => resolve(Buffer.concat(chunks)));
  stream.on('error', reject);
});

test('saves bytes under a nested key and reads them back', async () => {
  const buf = Buffer.from('hello pdf bytes');
  await storage.save(buf, 'user-1/abc-resume.pdf');
  const got = await read(storage.createReadStream('user-1/abc-resume.pdf'));
  expect(got.equals(buf)).toBe(true);
});

test('removes a stored file', async () => {
  await storage.save(Buffer.from('x'), 'user-1/gone.pdf');
  await storage.remove('user-1/gone.pdf');
  expect(fs.existsSync(path.join(tmpDir, 'user-1/gone.pdf'))).toBe(false);
});

test('remove is a no-op when the file is missing', async () => {
  await expect(storage.remove('user-1/never.pdf')).resolves.toBeUndefined();
});

test('readBuffer reads a stored object into one buffer', async () => {
  const buf = Buffer.from('resume bytes here');
  await storage.save(buf, 'user-1/read-me.pdf');
  const got = await storage.readBuffer('user-1/read-me.pdf');
  expect(got.equals(buf)).toBe(true);
});

test('readBuffer surfaces a read failure as a friendly 503 (not a raw 500)', async () => {
  // A missing object (like a paused/misconfigured object store returning an
  // unreadable response) must not bubble up as a generic "Internal server error".
  await expect(storage.readBuffer('user-1/does-not-exist.pdf')).rejects.toMatchObject({
    status: 503,
    code: 'STORAGE_UNAVAILABLE',
  });
});
