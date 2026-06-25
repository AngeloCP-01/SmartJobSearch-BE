const { aiMatch, complete } = require('./openrouter');

const okResponse = (payload) => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) });

beforeEach(() => { process.env.OPENROUTER_API_KEY = 'test-key'; process.env.OPENROUTER_MODEL = 'test/model:free'; });
afterEach(() => { delete process.env.OPENROUTER_API_KEY; delete process.env.OPENROUTER_MODEL; jest.restoreAllMocks(); });

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
