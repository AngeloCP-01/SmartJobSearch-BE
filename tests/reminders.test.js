const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

test('GET /api/reminders requires authentication (401)', async () => {
  const res = await agent().get('/api/reminders');
  expect(res.status).toBe(401);
});

test('an empty user gets a fully-shaped, zeroed payload', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/reminders').set(auth(token));

  expect(res.status).toBe(200);
  expect(res.body.interviews).toEqual({ upcoming: [], overdue: [] });
  expect(res.body.followUps).toEqual({ due: [], upcoming: [] });
  expect(res.body.counts).toEqual({ total: 0, interviews: 0, followUps: 0 });
});

test('categorizes interviews and follow-ups into the right buckets', async () => {
  const { token } = await registerAndLogin();
  const companyId = (await agent().post('/api/companies').set(auth(token)).send({ name: 'Acme' })).body.id;
  const appId = (await agent().post('/api/applications').set(auth(token))
    .send({ position: 'Backend Engineer', companyId })).body.id;

  // interviews
  await agent().post('/api/interviews').set(auth(token))
    .send({ applicationId: appId, type: 'Technical', scheduledAt: daysFromNow(2) });        // upcoming
  await agent().post('/api/interviews').set(auth(token))
    .send({ applicationId: appId, type: 'Final', scheduledAt: daysFromNow(30) });           // beyond window → excluded
  await agent().post('/api/interviews').set(auth(token))
    .send({ applicationId: appId, type: 'HR', scheduledAt: daysFromNow(-2) });               // overdue (result null)
  await agent().post('/api/interviews').set(auth(token))
    .send({ applicationId: appId, type: 'Managerial', scheduledAt: daysFromNow(-3), result: 'Passed' }); // excluded

  // follow-ups
  await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Due Person', companyId, followUpDate: daysFromNow(-3) });                 // due
  await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Soon Person', followUpDate: daysFromNow(3) });                            // upcoming
  await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Later Person', followUpDate: daysFromNow(30) });                          // excluded
  await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'No Date Person' });                                                       // excluded (null)

  const res = await agent().get('/api/reminders').set(auth(token));

  expect(res.body.interviews.upcoming).toHaveLength(1);
  expect(res.body.interviews.upcoming[0].type).toBe('Technical');
  expect(res.body.interviews.upcoming[0].application.position).toBe('Backend Engineer');
  expect(res.body.interviews.upcoming[0].application.company.name).toBe('Acme');
  expect(res.body.interviews.overdue).toHaveLength(1);
  expect(res.body.interviews.overdue[0].type).toBe('HR');

  expect(res.body.followUps.due.map((f) => f.name)).toEqual(['Due Person']);
  expect(res.body.followUps.upcoming.map((f) => f.name)).toEqual(['Soon Person']);

  expect(res.body.counts).toEqual({ total: 4, interviews: 2, followUps: 2 });
});

test('reminders are scoped to the current user', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();

  const appId = (await agent().post('/api/applications').set(auth(a.token))
    .send({ position: 'Theirs' })).body.id;
  await agent().post('/api/interviews').set(auth(a.token))
    .send({ applicationId: appId, type: 'HR', scheduledAt: daysFromNow(2) });
  await agent().post('/api/contacts').set(auth(a.token))
    .send({ name: 'Their Contact', followUpDate: daysFromNow(-1) });

  const res = await agent().get('/api/reminders').set(auth(b.token));
  expect(res.body.counts).toEqual({ total: 0, interviews: 0, followUps: 0 });
  expect(res.body.interviews.upcoming).toHaveLength(0);
  expect(res.body.followUps.due).toHaveLength(0);
});
