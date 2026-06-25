const { Readable } = require('stream');

// Mock the AWS SDK so the S3 driver runs with no network. The factory may only
// reference vars whose names begin with "mock" (jest hoisting rule).
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn((input) => ({ kind: 'put', input })),
  GetObjectCommand: jest.fn((input) => ({ kind: 'get', input })),
  DeleteObjectCommand: jest.fn((input) => ({ kind: 'delete', input })),
}));

// Must be set before requiring the driver — it captures S3_BUCKET and builds the
// S3Client (from env) at module load.
process.env.S3_BUCKET = 'docs';
process.env.S3_ENDPOINT = 'https://example.test';
process.env.S3_ACCESS_KEY_ID = 'k';
process.env.S3_SECRET_ACCESS_KEY = 's';
const s3 = require('../src/shared/storage/drivers/s3');

beforeEach(() => mockSend.mockReset());

const read = (stream) => new Promise((resolve, reject) => {
  const chunks = [];
  stream.on('data', (c) => chunks.push(c));
  stream.on('end', () => resolve(Buffer.concat(chunks)));
  stream.on('error', reject);
});

test('save PUTs the buffer under the bucket/key', async () => {
  mockSend.mockResolvedValue({});
  await s3.save(Buffer.from('hi'), 'user-1/a.pdf');
  const cmd = mockSend.mock.calls[0][0];
  expect(cmd).toMatchObject({ kind: 'put', input: { Bucket: 'docs', Key: 'user-1/a.pdf' } });
  expect(cmd.input.Body.toString()).toBe('hi');
});

test('createReadStream emits "open" then streams the object body', async () => {
  mockSend.mockResolvedValue({ Body: Readable.from([Buffer.from('pdf '), Buffer.from('bytes')]) });
  const stream = s3.createReadStream('user-1/a.pdf');
  const opened = new Promise((res) => stream.on('open', res));
  const body = await read(stream);
  await opened; // 'open' fired (download-header parity with the local driver)
  expect(body.toString()).toBe('pdf bytes');
  expect(mockSend.mock.calls[0][0]).toMatchObject({ kind: 'get', input: { Bucket: 'docs', Key: 'user-1/a.pdf' } });
});

test('createReadStream surfaces a missing object as a stream error', async () => {
  mockSend.mockRejectedValue(new Error('NoSuchKey'));
  await expect(read(s3.createReadStream('user-1/missing.pdf'))).rejects.toThrow('NoSuchKey');
});

test('remove DELETEs the object', async () => {
  mockSend.mockResolvedValue({});
  await s3.remove('user-1/a.pdf');
  expect(mockSend.mock.calls[0][0]).toMatchObject({ kind: 'delete', input: { Bucket: 'docs', Key: 'user-1/a.pdf' } });
});
