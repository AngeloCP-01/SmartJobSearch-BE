const { embed, embeddingConfigured } = require('./embeddings');

beforeEach(() => {
  process.env.EMBEDDING_MODEL = 'nvidia:nvidia/nv-embedqa-e5-v5';
  process.env.NVIDIA_BASE_URL = 'https://nv.test/v1';
  process.env.NVIDIA_OPENAI_KEY = 'nv-key';
});
afterEach(() => {
  delete process.env.EMBEDDING_MODEL; delete process.env.NVIDIA_BASE_URL; delete process.env.NVIDIA_OPENAI_KEY;
  jest.restoreAllMocks();
});

test('embed posts input_type + resolved model/base/key and returns vectors in order', async () => {
  let captured;
  global.fetch = jest.fn().mockImplementation((url, opts) => {
    captured = { url, opts };
    return Promise.resolve({ ok: true, json: async () => ({ data: [{ embedding: [1, 2, 3] }, { embedding: [4, 5, 6] }] }) });
  });
  const vectors = await embed(['alpha', 'beta'], 'passage');
  expect(String(captured.url)).toBe('https://nv.test/v1/embeddings');
  expect(captured.opts.headers.Authorization).toBe('Bearer nv-key');
  const body = JSON.parse(captured.opts.body);
  expect(body.model).toBe('nvidia/nv-embedqa-e5-v5');
  expect(body.input_type).toBe('passage');
  expect(body.input).toEqual(['alpha', 'beta']);
  expect(vectors).toEqual([[1, 2, 3], [4, 5, 6]]);
});

test('rejects an invalid input_type without calling the network', async () => {
  global.fetch = jest.fn();
  await expect(embed(['x'], 'nope')).rejects.toMatchObject({ kind: 'config' });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('empty input returns [] without a request', async () => {
  global.fetch = jest.fn();
  expect(await embed([], 'passage')).toEqual([]);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('missing provider key → config error', async () => {
  delete process.env.NVIDIA_OPENAI_KEY;
  await expect(embed(['x'], 'query')).rejects.toMatchObject({ kind: 'config' });
});

test('non-2xx → http error tagged with status', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'busy' });
  await expect(embed(['x'], 'query')).rejects.toMatchObject({ kind: 'http', status: 503 });
});

test('embeddingConfigured reflects whether the provider key is set', () => {
  expect(embeddingConfigured()).toBe(true);
  delete process.env.NVIDIA_OPENAI_KEY;
  expect(embeddingConfigured()).toBe(false);
});
