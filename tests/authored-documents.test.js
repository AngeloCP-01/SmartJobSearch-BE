const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const DOC = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] };

async function makeApplication(token) {
  const res = await agent().post('/api/applications').set(auth(token)).send({ position: 'Eng' });
  return res.body.id;
}

test('creates a document with defaults and lists it without content', async () => {
  const { token } = await registerAndLogin();
  const create = await agent().post('/api/authored-documents').set(auth(token))
    .send({ title: 'My Resume' });
  expect(create.status).toBe(201);
  expect(create.body).toMatchObject({ title: 'My Resume', type: 'Note', applicationId: null });
  expect(create.body.content).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });

  const list = await agent().get('/api/authored-documents').set(auth(token));
  expect(list.status).toBe(200);
  expect(list.body).toHaveLength(1);
  expect(list.body[0]).toMatchObject({ id: create.body.id, title: 'My Resume', type: 'Note' });
  expect(list.body[0].content).toBeUndefined();
});

test('title is required (400)', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/authored-documents').set(auth(token)).send({ type: 'Resume' });
  expect(res.status).toBe(400);
});

test('rejects an invalid type (400)', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/authored-documents').set(auth(token))
    .send({ title: 'X', type: 'Spreadsheet' });
  expect(res.status).toBe(400);
});

test('fetches a single document with its content', async () => {
  const { token } = await registerAndLogin();
  const created = await agent().post('/api/authored-documents').set(auth(token))
    .send({ title: 'Cover Letter', type: 'CoverLetter', content: DOC });
  const res = await agent().get(`/api/authored-documents/${created.body.id}`).set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body.content).toEqual(DOC);
});

test('updates title and content (autosave)', async () => {
  const { token } = await registerAndLogin();
  const created = await agent().post('/api/authored-documents').set(auth(token)).send({ title: 'Draft' });
  const res = await agent().patch(`/api/authored-documents/${created.body.id}`).set(auth(token))
    .send({ title: 'Final', content: DOC });
  expect(res.status).toBe(200);
  expect(res.body.title).toBe('Final');
  expect(res.body.content).toEqual(DOC);
});

test('can link to an application the user owns', async () => {
  const { token } = await registerAndLogin();
  const applicationId = await makeApplication(token);
  const res = await agent().post('/api/authored-documents').set(auth(token))
    .send({ title: 'Tailored CV', applicationId });
  expect(res.status).toBe(201);
  expect(res.body.applicationId).toBe(applicationId);
});

test('rejects an applicationId owned by another user (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const applicationId = await makeApplication(a.token);
  const res = await agent().post('/api/authored-documents').set(auth(b.token))
    .send({ title: 'Sneaky', applicationId });
  expect(res.status).toBe(404);
});

test("a user cannot read another user's document (404)", async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const created = await agent().post('/api/authored-documents').set(auth(a.token)).send({ title: 'Private' });
  const res = await agent().get(`/api/authored-documents/${created.body.id}`).set(auth(b.token));
  expect(res.status).toBe(404);
});

test("a user cannot PATCH another user's document (404)", async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const created = await agent().post('/api/authored-documents').set(auth(a.token)).send({ title: 'Private' });
  const res = await agent().patch(`/api/authored-documents/${created.body.id}`).set(auth(b.token))
    .send({ title: 'Hacked' });
  expect(res.status).toBe(404);
});

test("a user cannot DELETE another user's document (404)", async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const created = await agent().post('/api/authored-documents').set(auth(a.token)).send({ title: 'Private' });
  const res = await agent().delete(`/api/authored-documents/${created.body.id}`).set(auth(b.token));
  expect(res.status).toBe(404);
});

test("on PATCH, an applicationId owned by another user is rejected (404)", async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const created = await agent().post('/api/authored-documents').set(auth(a.token)).send({ title: 'My Doc' });
  const bAppId = await makeApplication(b.token);
  const res = await agent().patch(`/api/authored-documents/${created.body.id}`).set(auth(a.token))
    .send({ applicationId: bAppId });
  expect(res.status).toBe(404);
});

test('deletes a document', async () => {
  const { token } = await registerAndLogin();
  const created = await agent().post('/api/authored-documents').set(auth(token)).send({ title: 'Temp' });
  const del = await agent().delete(`/api/authored-documents/${created.body.id}`).set(auth(token));
  expect(del.status).toBe(204);
  const list = await agent().get('/api/authored-documents').set(auth(token));
  expect(list.body).toHaveLength(0);
});

test('requires authentication (401)', async () => {
  const res = await agent().get('/api/authored-documents');
  expect(res.status).toBe(401);
});
