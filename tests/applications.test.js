const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function makeCompany(token, name = 'Acme') {
  const res = await agent().post('/api/companies').set(auth(token)).send({ name });
  return res.body.id;
}

test('create an application (defaults to Draft) and list it', async () => {
  const { token } = await registerAndLogin();
  const companyId = await makeCompany(token);
  const res = await agent().post('/api/applications').set(auth(token))
    .send({ position: 'Backend Engineer', companyId });
  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ position: 'Backend Engineer', status: 'Draft', companyId });

  const list = await agent().get('/api/applications').set(auth(token));
  expect(list.body).toHaveLength(1);
});

test('application responses include the linked company {id,name}', async () => {
  const { token } = await registerAndLogin();
  const companyId = await makeCompany(token, 'Acme');
  const created = await agent().post('/api/applications').set(auth(token))
    .send({ position: 'Backend Eng', companyId });
  expect(created.body.company).toMatchObject({ id: companyId, name: 'Acme' });

  const list = await agent().get('/api/applications').set(auth(token));
  expect(list.body[0].company).toMatchObject({ id: companyId, name: 'Acme' });
});

test('an application with no company has company: null', async () => {
  const { token } = await registerAndLogin();
  const created = await agent().post('/api/applications').set(auth(token)).send({ position: 'X' });
  expect(created.body.company).toBeNull();
});

test('PATCH with companyId:null unlinks the company', async () => {
  const { token } = await registerAndLogin();
  const companyId = await makeCompany(token, 'Acme');
  const created = await agent().post('/api/applications').set(auth(token))
    .send({ position: 'X', companyId });
  const res = await agent().patch(`/api/applications/${created.body.id}`).set(auth(token))
    .send({ companyId: null });
  expect(res.status).toBe(200);
  expect(res.body.companyId).toBeNull();
  expect(res.body.company).toBeNull();
});

test('position is required (400)', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/applications').set(auth(token)).send({});
  expect(res.status).toBe(400);
});

test('rejects a companyId owned by another user (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const companyId = await makeCompany(a.token);
  const res = await agent().post('/api/applications').set(auth(b.token))
    .send({ position: 'X', companyId });
  expect(res.status).toBe(404);
});

test('accepts a long source URL (over 200 chars)', async () => {
  const { token } = await registerAndLogin();
  const longSource = `https://www.linkedin.com/jobs/search/?keywords=fullstack&${'param=value&'.repeat(30)}`;
  expect(longSource.length).toBeGreaterThan(200);
  const res = await agent().post('/api/applications').set(auth(token))
    .send({ position: 'Fullstack Software Developer', source: longSource });
  expect(res.status).toBe(201);
  expect(res.body.source).toBe(longSource);
});

test('rejects salaryMin greater than salaryMax (400)', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/applications').set(auth(token))
    .send({ position: 'X', salaryMin: 100, salaryMax: 50 });
  expect(res.status).toBe(400);
});

test('PATCH /:id/status moves the application (Kanban)', async () => {
  const { token } = await registerAndLogin();
  const created = await agent().post('/api/applications').set(auth(token))
    .send({ position: 'Backend Engineer' });
  const res = await agent().patch(`/api/applications/${created.body.id}/status`)
    .set(auth(token)).send({ status: 'Applied' });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('Applied');
});

test('PATCH /:id/status rejects an invalid status (400)', async () => {
  const { token } = await registerAndLogin();
  const created = await agent().post('/api/applications').set(auth(token))
    .send({ position: 'X' });
  const res = await agent().patch(`/api/applications/${created.body.id}/status`)
    .set(auth(token)).send({ status: 'NotAStatus' });
  expect(res.status).toBe(400);
});

test('filter by status', async () => {
  const { token } = await registerAndLogin();
  const a = await agent().post('/api/applications').set(auth(token)).send({ position: 'A' });
  await agent().post('/api/applications').set(auth(token)).send({ position: 'B' });
  await agent().patch(`/api/applications/${a.body.id}/status`).set(auth(token))
    .send({ status: 'Applied' });
  const res = await agent().get('/api/applications?status=Applied').set(auth(token));
  expect(res.body).toHaveLength(1);
  expect(res.body[0].position).toBe('A');
});

test('a user cannot touch another user\'s application (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const created = await agent().post('/api/applications').set(auth(a.token))
    .send({ position: 'Secret' });
  const res = await agent().get(`/api/applications/${created.body.id}`).set(auth(b.token));
  expect(res.status).toBe(404);
});
