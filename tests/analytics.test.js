const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

const STATUS_ORDER = [
  'Draft', 'Applied', 'HR_Screening', 'Technical_Interview',
  'Final_Interview', 'Offer', 'Accepted', 'Rejected', 'Withdrawn',
];

test('GET /api/analytics requires authentication (401)', async () => {
  const res = await agent().get('/api/analytics');
  expect(res.status).toBe(401);
});

test('an empty user gets a zeroed, fully-shaped payload', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/analytics').set(auth(token));

  expect(res.status).toBe(200);
  expect(res.body.metrics).toEqual({
    totalApplications: 0, interviewRate: 0, offerRate: 0, rejectionRate: 0,
  });
  expect(res.body.funnel).toHaveLength(9);
  expect(res.body.funnel.map((f) => f.status)).toEqual(STATUS_ORDER);
  expect(res.body.funnel.every((f) => f.count === 0)).toBe(true);
  expect(res.body.overTime).toHaveLength(12);
  expect(res.body.overTime.every((b) => b.count === 0)).toBe(true);
  expect(res.body.overTime[0].month).toMatch(/^\d{4}-\d{2}$/);
});

test('metrics and funnel reflect seeded applications and interviews', async () => {
  const { token } = await registerAndLogin();

  const mk = async (status) => {
    const r = await agent().post('/api/applications').set(auth(token)).send({ position: status });
    if (status !== 'Draft') {
      await agent().patch(`/api/applications/${r.body.id}/status`).set(auth(token)).send({ status });
    }
    return r.body.id;
  };
  const addInterview = (id) =>
    agent().post('/api/interviews').set(auth(token)).send({ applicationId: id, type: 'HR' });

  await mk('Draft');                              // no interview
  const applied = await mk('Applied');           // interview
  const tech = await mk('Technical_Interview');  // interview
  const offer = await mk('Offer');               // interview
  const rejected = await mk('Rejected');         // interview
  await Promise.all([applied, tech, offer, rejected].map(addInterview));

  const res = await agent().get('/api/analytics').set(auth(token));
  expect(res.body.metrics.totalApplications).toBe(5);
  expect(res.body.metrics.interviewRate).toBeCloseTo(4 / 5);  // 4 of 5 have an interview
  expect(res.body.metrics.offerRate).toBeCloseTo(1 / 5);      // Offer + Accepted
  expect(res.body.metrics.rejectionRate).toBeCloseTo(1 / 5);  // Rejected

  const byStatus = Object.fromEntries(res.body.funnel.map((f) => [f.status, f.count]));
  expect(byStatus.Draft).toBe(1);
  expect(byStatus.Applied).toBe(1);
  expect(byStatus.Technical_Interview).toBe(1);
  expect(byStatus.Offer).toBe(1);
  expect(byStatus.Rejected).toBe(1);
  expect(byStatus.Accepted).toBe(0);
});
