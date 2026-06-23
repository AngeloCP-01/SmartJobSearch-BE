const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function makeApplication(token) {
  const res = await agent().post('/api/applications').set(auth(token)).send({ position: 'Eng' });
  return res.body.id;
}

test('create and list an interview for an application', async () => {
  const { token } = await registerAndLogin();
  const applicationId = await makeApplication(token);
  const res = await agent().post('/api/interviews').set(auth(token))
    .send({ applicationId, type: 'Technical', interviewer: 'Grace' });
  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ applicationId, type: 'Technical', interviewer: 'Grace' });

  const list = await agent().get(`/api/interviews?applicationId=${applicationId}`).set(auth(token));
  expect(list.body).toHaveLength(1);
});

test('type must be valid (400)', async () => {
  const { token } = await registerAndLogin();
  const applicationId = await makeApplication(token);
  const res = await agent().post('/api/interviews').set(auth(token))
    .send({ applicationId, type: 'Coffee' });
  expect(res.status).toBe(400);
});

test('rejects an applicationId owned by another user (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const applicationId = await makeApplication(a.token);
  const res = await agent().post('/api/interviews').set(auth(b.token))
    .send({ applicationId, type: 'HR' });
  expect(res.status).toBe(404);
});

test('update an interview result', async () => {
  const { token } = await registerAndLogin();
  const applicationId = await makeApplication(token);
  const created = await agent().post('/api/interviews').set(auth(token))
    .send({ applicationId, type: 'HR' });
  const res = await agent().patch(`/api/interviews/${created.body.id}`).set(auth(token))
    .send({ result: 'Passed' });
  expect(res.body.result).toBe('Passed');
});

test('a user cannot read another user\'s interview (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const applicationId = await makeApplication(a.token);
  const created = await agent().post('/api/interviews').set(auth(a.token))
    .send({ applicationId, type: 'HR' });
  const res = await agent().get(`/api/interviews/${created.body.id}`).set(auth(b.token));
  expect(res.status).toBe(404);
});
