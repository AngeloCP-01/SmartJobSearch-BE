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
