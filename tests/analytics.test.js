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

const MONTHS = 12;
function monthKeysForTest(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - (MONTHS - 1));
  const keys = [];
  for (let i = 0; i < MONTHS; i += 1) {
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return keys;
}
function midMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15, 12, 0, 0)); // mid-month noon → TZ-safe bucket
}

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

test('over time buckets by month with applicationDate/createdAt fallback and zero-fill', async () => {
  const { user, token } = await registerAndLogin();
  const keys = monthKeysForTest();
  const current = keys[11];
  const prior = keys[6];

  // 2 in the current month via applicationDate
  await prisma.application.createMany({ data: [
    { userId: user.id, position: 'a', applicationDate: midMonth(current) },
    { userId: user.id, position: 'b', applicationDate: midMonth(current) },
  ] });
  // 1 in a prior in-window month via the createdAt fallback (applicationDate null)
  await prisma.application.create({
    data: { userId: user.id, position: 'c', createdAt: midMonth(prior) },
  });
  // 1 OUTSIDE the window (13 months back) — must be excluded
  const now = new Date();
  const outOfWindow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 13, 15, 12, 0, 0));
  await prisma.application.create({
    data: { userId: user.id, position: 'old', applicationDate: outOfWindow },
  });

  const res = await agent().get('/api/analytics').set(auth(token));
  expect(res.body.overTime).toHaveLength(12);
  const counts = Object.fromEntries(res.body.overTime.map((b) => [b.month, b.count]));
  expect(counts[current]).toBe(2);
  expect(counts[prior]).toBe(1);
  // only the 3 in-window apps are counted across the whole window
  expect(res.body.overTime.reduce((s, b) => s + b.count, 0)).toBe(3);
});
