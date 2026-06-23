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

async function makeApplication(token, position = 'Backend Eng') {
  const res = await agent().post('/api/applications').set(auth(token)).send({ position });
  return res.body.id;
}

test('link a contact to an application; it appears on application detail', async () => {
  const { token } = await registerAndLogin();
  const companyId = await makeCompany(token, 'Acme');
  const appId = await makeApplication(token);
  const c = await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Jane', position: 'Recruiter', companyId });

  const link = await agent().post(`/api/applications/${appId}/contacts`).set(auth(token))
    .send({ contactId: c.body.id });
  expect(link.status).toBe(201);

  const detail = await agent().get(`/api/applications/${appId}`).set(auth(token));
  expect(detail.body.contacts).toHaveLength(1);
  expect(detail.body.contacts[0]).toMatchObject({ id: c.body.id, name: 'Jane', position: 'Recruiter' });
  expect(detail.body.contacts[0].company).toMatchObject({ id: companyId, name: 'Acme' });
});

test('linking the same contact twice returns 409', async () => {
  const { token } = await registerAndLogin();
  const appId = await makeApplication(token);
  const c = await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jane' });
  await agent().post(`/api/applications/${appId}/contacts`).set(auth(token)).send({ contactId: c.body.id });
  const dup = await agent().post(`/api/applications/${appId}/contacts`).set(auth(token)).send({ contactId: c.body.id });
  expect(dup.status).toBe(409);
});

test('unlink a contact from an application', async () => {
  const { token } = await registerAndLogin();
  const appId = await makeApplication(token);
  const c = await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jane' });
  await agent().post(`/api/applications/${appId}/contacts`).set(auth(token)).send({ contactId: c.body.id });
  const unlink = await agent().delete(`/api/applications/${appId}/contacts/${c.body.id}`).set(auth(token));
  expect(unlink.status).toBe(204);
  const detail = await agent().get(`/api/applications/${appId}`).set(auth(token));
  expect(detail.body.contacts).toHaveLength(0);
});

test('an application with no contacts has contacts: []', async () => {
  const { token } = await registerAndLogin();
  const appId = await makeApplication(token);
  const detail = await agent().get(`/api/applications/${appId}`).set(auth(token));
  expect(detail.body.contacts).toEqual([]);
});

test('cannot link another user\'s contact (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const appId = await makeApplication(b.token);
  const c = await agent().post('/api/contacts').set(auth(a.token)).send({ name: 'Jane' });
  const res = await agent().post(`/api/applications/${appId}/contacts`).set(auth(b.token))
    .send({ contactId: c.body.id });
  expect(res.status).toBe(404);
});

test('cannot link to another user\'s application (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const appId = await makeApplication(a.token);
  const c = await agent().post('/api/contacts').set(auth(b.token)).send({ name: 'Jane' });
  const res = await agent().post(`/api/applications/${appId}/contacts`).set(auth(b.token))
    .send({ contactId: c.body.id });
  expect(res.status).toBe(404);
});

test('unlinking a contact that is not linked is idempotent (204)', async () => {
  const { token } = await registerAndLogin();
  const appId = await makeApplication(token);
  const c = await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jane' });
  const res = await agent().delete(`/api/applications/${appId}/contacts/${c.body.id}`).set(auth(token));
  expect(res.status).toBe(204);
});

test('deleting a contact removes its application links (cascade)', async () => {
  const { token } = await registerAndLogin();
  const appId = await makeApplication(token);
  const c = await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jane' });
  await agent().post(`/api/applications/${appId}/contacts`).set(auth(token)).send({ contactId: c.body.id });
  await agent().delete(`/api/contacts/${c.body.id}`).set(auth(token));
  const detail = await agent().get(`/api/applications/${appId}`).set(auth(token));
  expect(detail.body.contacts).toEqual([]);
});

test('PATCH /contacts/:id clears followUpDate with null', async () => {
  const { token } = await registerAndLogin();
  const created = await agent().post('/api/contacts').set(auth(token))
    .send({ name: 'Recruiter', followUpDate: '2026-06-20T00:00:00.000Z' });
  expect(created.body.followUpDate).not.toBeNull();

  const patched = await agent().patch(`/api/contacts/${created.body.id}`).set(auth(token))
    .send({ followUpDate: null });
  expect(patched.status).toBe(200);
  expect(patched.body.followUpDate).toBeNull();
});
