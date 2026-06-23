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

test('create + list a contact (company included)', async () => {
  const { token } = await registerAndLogin();
  const companyId = await makeCompany(token, 'Acme');
  const created = await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Jane Recruiter', email: 'jane@acme.com', position: 'Recruiter', companyId });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ name: 'Jane Recruiter', position: 'Recruiter' });
  expect(created.body.company).toMatchObject({ id: companyId, name: 'Acme' });

  const list = await agent().get('/api/contacts').set(auth(token));
  expect(list.status).toBe(200);
  expect(list.body).toHaveLength(1);
  expect(list.body[0].company).toMatchObject({ id: companyId, name: 'Acme' });
});

test('a contact with no company has company: null', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/contacts').set(auth(token)).send({ name: 'Solo' });
  expect(res.status).toBe(201);
  expect(res.body.company).toBeNull();
});

test('create requires a name (400)', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/contacts').set(auth(token)).send({ email: 'x@y.com' });
  expect(res.status).toBe(400);
});

test('rejects a malformed email (400)', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Bad', email: 'not-an-email' });
  expect(res.status).toBe(400);
});

test('rejects a malformed linkedinUrl (400)', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Bad', linkedinUrl: 'notaurl' });
  expect(res.status).toBe(400);
});

test('requires authentication (401)', async () => {
  const res = await agent().get('/api/contacts');
  expect(res.status).toBe(401);
});

test('search filters by name or email (case-insensitive)', async () => {
  const { token } = await registerAndLogin();
  await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jane', email: 'jane@acme.com' });
  await agent().post('/api/contacts').set(auth(token)).send({ name: 'Bob', email: 'bob@globex.com' });
  const byName = await agent().get('/api/contacts?search=jan').set(auth(token));
  expect(byName.body).toHaveLength(1);
  expect(byName.body[0].name).toBe('Jane');
  const byEmail = await agent().get('/api/contacts?search=globex').set(auth(token));
  expect(byEmail.body).toHaveLength(1);
  expect(byEmail.body[0].name).toBe('Bob');
});

test('update a contact, then clear its company with companyId:null', async () => {
  const { token } = await registerAndLogin();
  const companyId = await makeCompany(token, 'Acme');
  const c = await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jane', companyId });
  const upd = await agent().patch(`/api/contacts/${c.body.id}`).set(auth(token))
    .send({ position: 'Lead Recruiter' });
  expect(upd.body.position).toBe('Lead Recruiter');
  const cleared = await agent().patch(`/api/contacts/${c.body.id}`).set(auth(token))
    .send({ companyId: null });
  expect(cleared.body.companyId).toBeNull();
  expect(cleared.body.company).toBeNull();
});

test('delete a contact', async () => {
  const { token } = await registerAndLogin();
  const c = await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jane' });
  const del = await agent().delete(`/api/contacts/${c.body.id}`).set(auth(token));
  expect(del.status).toBe(204);
  const after = await agent().get('/api/contacts').set(auth(token));
  expect(after.body).toHaveLength(0);
});

test('rejects a companyId owned by another user (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const companyId = await makeCompany(a.token);
  const res = await agent().post('/api/contacts').set(auth(b.token))
    .send({ name: 'X', companyId });
  expect(res.status).toBe(404);
});

test('a user cannot read another user\'s contact (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const c = await agent().post('/api/contacts').set(auth(a.token)).send({ name: 'Secret' });
  const res = await agent().get(`/api/contacts/${c.body.id}`).set(auth(b.token));
  expect(res.status).toBe(404);
});
