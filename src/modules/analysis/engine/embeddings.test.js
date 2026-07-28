const { embed, embeddingConfigured } = require('./embeddings');
const { logger } = require('../../../shared/observability/logger');

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

// Embedding is the other AI call on the hot path (indexing + every RAG query),
// so it needs the same cost/latency record as a completion. The vectors are the
// return value, so telemetry can only surface through the log.
test('a successful embedding logs batch size, latency and token usage', async () => {
  const info = jest.spyOn(logger, 'info').mockImplementation(() => {});
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{ embedding: [1] }, { embedding: [2] }], usage: { prompt_tokens: 88, total_tokens: 88 } }),
  });
  await embed(['alpha', 'beta'], 'query');
  expect(info).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'nvidia/nv-embedqa-e5-v5', provider: 'nvidia', inputType: 'query', batchSize: 2, promptTokens: 88, totalTokens: 88,
    }),
    '[ai] embedding',
  );
  expect(typeof info.mock.calls[0][0].latencyMs).toBe('number');
});

test('embeddingConfigured reflects whether the provider key is set', () => {
  expect(embeddingConfigured()).toBe(true);
  delete process.env.NVIDIA_OPENAI_KEY;
  expect(embeddingConfigured()).toBe(false);
});
