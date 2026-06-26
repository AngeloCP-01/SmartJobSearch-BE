jest.mock('../src/modules/analysis/engine/openrouter');
const { generateJson } = require('../src/modules/analysis/engine/openrouter');

const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterEach(() => { delete process.env.OPENROUTER_API_KEY; jest.restoreAllMocks(); });
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

test('requires authentication (401)', async () => {
  expect((await agent().post('/api/postings/parse').send({ content: 'x' })).status).toBe(401);
});

test('parses pasted posting text into application fields; keeps the text verbatim as the JD', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateJson.mockResolvedValue({
    data: { position: 'Backend Engineer', companyName: 'Acme', salaryMin: 120000, salaryMax: 150000, jobDescription: 'ignored for pasted text' },
    model: 'm',
  });
  const { token } = await registerAndLogin();
  const posting = 'Backend Engineer at Acme\nResponsibilities:\n- Build APIs\nSalary 120k–150k';
  const res = await agent().post('/api/postings/parse').set(auth(token)).send({ content: posting });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ position: 'Backend Engineer', companyName: 'Acme', salaryMin: 120000, salaryMax: 150000, source: null });
  expect(res.body.jobDescription).toBe(posting); // pasted text preserved exactly
});

test('needs AI configured → 503, and never calls the model, when no key', async () => {
  delete process.env.OPENROUTER_API_KEY;
  generateJson.mockReset();
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/postings/parse').set(auth(token)).send({ content: 'A sufficiently long job posting body to parse.' });
  expect(res.status).toBe(503);
  expect(generateJson).not.toHaveBeenCalled();
});

test('AI failure surfaces a friendly 503', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateJson.mockReset().mockRejectedValue(Object.assign(new Error('429 rate limited'), { kind: 'http', status: 429 }));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const { token } = await registerAndLogin();
    const res = await agent().post('/api/postings/parse').set(auth(token)).send({ content: 'A sufficiently long job posting body to parse here.' });
    expect(res.status).toBe(503);
  } finally { warn.mockRestore(); }
});

test('rejects a private/loopback URL without calling the model (SSRF guard, 400)', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateJson.mockReset();
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/postings/parse').set(auth(token)).send({ content: 'http://localhost:4000/admin' });
  expect(res.status).toBe(400);
  expect(generateJson).not.toHaveBeenCalled();
});
