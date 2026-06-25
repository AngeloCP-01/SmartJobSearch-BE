const { aiMatch, complete, completeWithFallback } = require('./openrouter');

const okResponse = (payload) => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) });
const errResponse = (status, body = 'err') => ({ ok: false, status, text: async () => body });
const EMPTY_OK = okResponse({ skills: [], suggestions: [] });
const modelOf = (opts) => JSON.parse(opts.body).model;

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_MODEL = 'test/model:free';
  process.env.OPENROUTER_RETRY_BASE_MS = '0'; // no real backoff delay in tests
});
afterEach(() => {
  delete process.env.OPENROUTER_API_KEY; delete process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_RETRY_BASE_MS; delete process.env.OPENROUTER_ATTEMPTS;
  delete process.env.OPENROUTER_RETRY_AFTER_MAX_MS;
  jest.restoreAllMocks();
});
const rateLimited = (retryAfterSecs) => ({
  ok: false, status: 429, text: async () => 'rate-limited',
  headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? String(retryAfterSecs) : null) },
});

test('aiMatch maps LLM skills to matched/missing + weighted score + ai suggestions', async () => {
  global.fetch = jest.fn().mockResolvedValue(okResponse({
    skills: [
      { term: 'kubernetes', type: 'hard', present: false },
      { term: 'java', type: 'hard', present: true },
      { term: 'communication', type: 'soft', present: true },
    ],
    suggestions: [{ text: 'Add Kubernetes.', severity: 'high' }],
  }));
  const r = await aiMatch('java dev, good communication', 'need java, kubernetes, communication');
  expect(r.matched.map((e) => e.term)).toEqual(expect.arrayContaining(['java', 'communication']));
  expect(r.missing.map((e) => e.term)).toEqual(['kubernetes']);
  expect(r.matchScore).toBeGreaterThan(0);
  expect(r.matchScore).toBeLessThanOrEqual(100);
  expect(r.suggestions[0]).toMatchObject({ severity: 'high', source: 'ai' });
  expect(r.model).toBe('test/model:free');
});

test('complete sends a json_object request with auth + temperature 0', async () => {
  let captured;
  global.fetch = jest.fn().mockImplementation((url, opts) => { captured = { url, opts }; return Promise.resolve(okResponse({ skills: [], suggestions: [] })); });
  await complete('resume', 'jd');
  expect(String(captured.url)).toContain('/chat/completions');
  expect(captured.opts.headers.Authorization).toBe('Bearer test-key');
  const body = JSON.parse(captured.opts.body);
  expect(body.temperature).toBe(0);
  expect(body.response_format.type).toBe('json_object');
  expect(body.model).toBe('test/model:free');
});

test('lenient parse: JSON wrapped in prose / markdown fences still works', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'Here you go:\n```json\n{"skills":[{"term":"java","type":"hard","present":true}],"suggestions":[]}\n```' } }] }),
  });
  const r = await aiMatch('java', 'need java');
  expect(r.matched.map((e) => e.term)).toEqual(['java']);
});

test('no API key → throws (caller will fall back)', async () => {
  delete process.env.OPENROUTER_API_KEY;
  await expect(aiMatch('r', 'j')).rejects.toThrow();
});

test('non-2xx response → throws', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
  await expect(aiMatch('r', 'j')).rejects.toThrow();
});

test('malformed JSON content → throws', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) });
  await expect(aiMatch('r', 'j')).rejects.toThrow();
});

test('schema-violating JSON → throws', async () => {
  global.fetch = jest.fn().mockResolvedValue(okResponse({ skills: [{ term: 'x' }], suggestions: [] }));
  await expect(aiMatch('r', 'j')).rejects.toThrow();
});

test('non-2xx error includes the status and response body for diagnostics', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false, status: 429, text: async () => 'rate limit exceeded: free-models-per-day',
  });
  const err = await complete('r', 'j').catch((e) => e);
  expect(err.message).toContain('429');
  expect(err.message).toContain('rate limit exceeded');
});

test('missing API key → error tagged kind "config"', async () => {
  delete process.env.OPENROUTER_API_KEY;
  await expect(complete('r', 'j')).rejects.toMatchObject({ kind: 'config' });
});

test('non-2xx → error tagged kind "http" with status', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'upstream unavailable' });
  await expect(complete('r', 'j')).rejects.toMatchObject({ kind: 'http', status: 503 });
});

test('aborted/timed-out request → error tagged kind "timeout"', async () => {
  global.fetch = jest.fn().mockImplementation(() => {
    const e = new Error('The operation was aborted'); e.name = 'AbortError';
    return Promise.reject(e);
  });
  await expect(complete('r', 'j')).rejects.toMatchObject({ kind: 'timeout' });
});

test('malformed model output → error tagged kind "parse"', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) });
  await expect(complete('r', 'j')).rejects.toMatchObject({ kind: 'parse' });
});

test('abort while reading the response body → still tagged kind "timeout"', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; throw e; },
  });
  await expect(complete('r', 'j')).rejects.toMatchObject({ kind: 'timeout' });
});

// --- retry + model fallback (completeWithFallback) ---

test('retries a transient 5xx on the same model, then succeeds', async () => {
  process.env.OPENROUTER_MODEL = 'a/model:free';
  let n = 0;
  global.fetch = jest.fn().mockImplementation(() => { n += 1; return Promise.resolve(n === 1 ? errResponse(503) : EMPTY_OK); });
  const r = await completeWithFallback('r', 'j');
  expect(r.model).toBe('a/model:free');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('a 429 is NOT retried on the same model — it falls straight to the next', async () => {
  process.env.OPENROUTER_MODEL = 'a/model:free, b/model:free';
  const calls = {};
  global.fetch = jest.fn().mockImplementation((url, opts) => {
    const m = modelOf(opts); calls[m] = (calls[m] || 0) + 1;
    return Promise.resolve(m === 'a/model:free' ? errResponse(429) : EMPTY_OK);
  });
  const r = await completeWithFallback('r', 'j');
  expect(r.model).toBe('b/model:free');
  expect(calls['a/model:free']).toBe(1); // rate-limited model tried once, not retried
});

test('stops immediately on a fatal auth error without trying other models', async () => {
  process.env.OPENROUTER_MODEL = 'a/model:free, b/model:free';
  global.fetch = jest.fn().mockResolvedValue(errResponse(401, 'no credits'));
  await expect(completeWithFallback('r', 'j')).rejects.toMatchObject({ kind: 'http', status: 401 });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('a non-transient parse failure is not retried but does fall through to the next model', async () => {
  process.env.OPENROUTER_MODEL = 'a/model:free, b/model:free';
  global.fetch = jest.fn().mockImplementation((url, opts) => (modelOf(opts) === 'a/model:free'
    ? Promise.resolve({ ok: true, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) })
    : Promise.resolve(EMPTY_OK)));
  const r = await completeWithFallback('r', 'j');
  expect(r.model).toBe('b/model:free');
  expect(global.fetch).toHaveBeenCalledTimes(2); // A once (no retry on parse) + B once
});

test('429 error carries retryAfterMs parsed from the Retry-After header', async () => {
  process.env.OPENROUTER_MODEL = 'a/model:free';
  global.fetch = jest.fn().mockResolvedValue(rateLimited(5));
  await expect(complete('r', 'j', 'a/model:free')).rejects.toMatchObject({ kind: 'http', status: 429, retryAfterMs: 5000 });
});

test('when the whole chain is rate-limited, honors Retry-After and re-sweeps once', async () => {
  process.env.OPENROUTER_MODEL = 'a/model:free, b/model:free';
  process.env.OPENROUTER_RETRY_AFTER_MAX_MS = '10000';
  global.fetch = jest.fn().mockImplementation((url, opts) => {
    const firstSweep = global.fetch.mock.calls.length <= 2; // a, b on the first pass
    return Promise.resolve(firstSweep ? rateLimited(0) : (modelOf(opts) === 'a/model:free' ? EMPTY_OK : rateLimited(0)));
  });
  const r = await completeWithFallback('r', 'j');
  expect(r.model).toBe('a/model:free');
  expect(global.fetch).toHaveBeenCalledTimes(3); // sweep1: a,b (429) + sweep2: a (ok)
});

test('does not re-sweep when Retry-After exceeds the cap', async () => {
  process.env.OPENROUTER_MODEL = 'a/model:free, b/model:free';
  process.env.OPENROUTER_RETRY_AFTER_MAX_MS = '10000';
  global.fetch = jest.fn().mockResolvedValue(rateLimited(60)); // 60s > 10s cap
  await expect(completeWithFallback('r', 'j')).rejects.toMatchObject({ status: 429 });
  expect(global.fetch).toHaveBeenCalledTimes(2); // one sweep only, no retry
});

test('throws the last error when every model is exhausted', async () => {
  process.env.OPENROUTER_MODEL = 'a/model:free, b/model:free';
  process.env.OPENROUTER_ATTEMPTS = '2';
  global.fetch = jest.fn().mockResolvedValue(errResponse(503, 'down'));
  await expect(completeWithFallback('r', 'j')).rejects.toMatchObject({ kind: 'http', status: 503 });
  expect(global.fetch).toHaveBeenCalledTimes(4); // 2 models × 2 attempts
});
