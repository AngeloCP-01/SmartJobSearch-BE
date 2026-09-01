const { embed, embeddingConfigured, EMBEDDING_DIMENSIONS } = require('./embeddings');
const { logger } = require('../../../shared/observability/logger');

beforeEach(() => {
  process.env.EMBEDDING_MODEL = 'nvidia:nvidia/llama-nemotron-embed-vl-1b-v2';
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
  expect(body.model).toBe('nvidia/llama-nemotron-embed-vl-1b-v2');
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
      model: 'nvidia/llama-nemotron-embed-vl-1b-v2', provider: 'nvidia', inputType: 'query', batchSize: 2, promptTokens: 88, totalTokens: 88,
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

// --- model migration 2026-09-01 -------------------------------------------
// nv-embedqa-e5-v5 reached end of life 2026-08-25 (410 Gone). Its replacement,
// llama-nemotron-embed-vl-1b-v2, is natively 2048-dim and must be truncated
// (Matryoshka) to 1024 to fit the `vector(1024)` column. Sending no `dimensions`
// yields 2048-wide vectors that the column rejects on insert.
test('requests the dimension that matches the vector(1024) column', async () => {
  let body;
  global.fetch = jest.fn().mockImplementation((url, opts) => {
    body = JSON.parse(opts.body);
    return Promise.resolve({ ok: true, json: async () => ({ data: [{ embedding: [1] }] }) });
  });
  await embed(['alpha'], 'passage');
  expect(body.dimensions).toBe(EMBEDDING_DIMENSIONS);
  expect(EMBEDDING_DIMENSIONS).toBe(1024);
});

test('the default embedding model is one that is actually still served', async () => {
  delete process.env.EMBEDDING_MODEL;
  let body;
  global.fetch = jest.fn().mockImplementation((url, opts) => {
    body = JSON.parse(opts.body);
    return Promise.resolve({ ok: true, json: async () => ({ data: [{ embedding: [1] }] }) });
  });
  await embed(['alpha'], 'query');
  expect(body.model).not.toMatch(/nv-embedqa-e5-v5/);
  expect(body.model).toBe('nvidia/llama-nemotron-embed-vl-1b-v2');
});
