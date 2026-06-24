const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

test('GET /api/activity requires authentication (401)', async () => {
  const res = await agent().get('/api/activity');
  expect(res.status).toBe(401);
});

test('an empty user gets an empty feed', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().get('/api/activity').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ items: [], nextCursor: null });
});

test('creating an application logs ApplicationCreated', async () => {
  const { token } = await registerAndLogin();
  await agent().post('/api/applications').set(auth(token)).send({ position: 'Backend Engineer' });
  const res = await agent().get('/api/activity').set(auth(token));
  expect(res.body.items).toHaveLength(1);
  expect(res.body.items[0]).toMatchObject({
    action: 'ApplicationCreated',
    metadata: { position: 'Backend Engineer' },
  });
  expect(res.body.items[0].userId).toBeUndefined();
});

test('activity is scoped to the current user', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  await agent().post('/api/applications').set(auth(a.token)).send({ position: 'Theirs' });
  const res = await agent().get('/api/activity').set(auth(b.token));
  expect(res.body.items).toEqual([]);
});

async function makeApp(token, position = 'Eng') {
  return (await agent().post('/api/applications').set(auth(token)).send({ position })).body;
}

test('changing status logs ApplicationStatusChanged with from/to', async () => {
  const { token } = await registerAndLogin();
  const app = await makeApp(token);
  await agent().patch(`/api/applications/${app.id}/status`).set(auth(token)).send({ status: 'Applied' });
  const res = await agent().get(`/api/activity?applicationId=${app.id}`).set(auth(token));
  const statusEvents = res.body.items.filter((i) => i.action === 'ApplicationStatusChanged');
  expect(statusEvents).toHaveLength(1);
  expect(statusEvents[0].metadata).toMatchObject({ from: 'Draft', to: 'Applied', position: 'Eng' });
});

test('setting status to its current value logs nothing', async () => {
  const { token } = await registerAndLogin();
  const app = await makeApp(token);
  await agent().patch(`/api/applications/${app.id}/status`).set(auth(token)).send({ status: 'Draft' });
  const res = await agent().get(`/api/activity?applicationId=${app.id}`).set(auth(token));
  expect(res.body.items.filter((i) => i.action === 'ApplicationStatusChanged')).toHaveLength(0);
});

test('deleting an application logs ApplicationDeleted that survives the delete', async () => {
  const { token } = await registerAndLogin();
  const app = await makeApp(token, 'Doomed');
  await agent().delete(`/api/applications/${app.id}`).set(auth(token));
  const res = await agent().get('/api/activity').set(auth(token));
  const del = res.body.items.find((i) => i.action === 'ApplicationDeleted');
  expect(del).toBeTruthy();
  expect(del.applicationId).toBeNull();
  expect(del.metadata).toMatchObject({ position: 'Doomed' });
});

test('scheduling an interview logs InterviewScheduled', async () => {
  const { token } = await registerAndLogin();
  const app = await makeApp(token, 'Eng');
  await agent().post('/api/interviews').set(auth(token)).send({ applicationId: app.id, type: 'Technical' });
  const res = await agent().get(`/api/activity?applicationId=${app.id}`).set(auth(token));
  const ev = res.body.items.find((i) => i.action === 'InterviewScheduled');
  expect(ev).toBeTruthy();
  expect(ev.metadata).toMatchObject({ position: 'Eng', type: 'Technical' });
});

test('recording a Passed/Failed result logs InterviewResultRecorded; a notes edit does not', async () => {
  const { token } = await registerAndLogin();
  const app = await makeApp(token, 'Eng');
  const iv = (await agent().post('/api/interviews').set(auth(token)).send({ applicationId: app.id, type: 'HR' })).body;

  await agent().patch(`/api/interviews/${iv.id}`).set(auth(token)).send({ notes: 'went ok' });
  let res = await agent().get(`/api/activity?applicationId=${app.id}`).set(auth(token));
  expect(res.body.items.filter((i) => i.action === 'InterviewResultRecorded')).toHaveLength(0);

  await agent().patch(`/api/interviews/${iv.id}`).set(auth(token)).send({ result: 'Passed' });
  res = await agent().get(`/api/activity?applicationId=${app.id}`).set(auth(token));
  const ev = res.body.items.find((i) => i.action === 'InterviewResultRecorded');
  expect(ev).toBeTruthy();
  expect(ev.metadata).toMatchObject({ position: 'Eng', type: 'HR', result: 'Passed' });
});

test('linking a document logs DocumentLinked, and a contact logs ContactLinked', async () => {
  const { token } = await registerAndLogin();
  const app = await makeApp(token, 'Eng');
  const docId = (await agent().post('/api/documents').set(auth(token))
    .field('name', 'Resume v2').field('type', 'Resume')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'r.pdf', contentType: 'application/pdf' })).body.id;
  const contactId = (await agent().post('/api/contacts').set(auth(token)).send({ name: 'Jane Recruiter' })).body.id;

  await agent().post(`/api/applications/${app.id}/documents`).set(auth(token)).send({ documentId: docId });
  await agent().post(`/api/applications/${app.id}/contacts`).set(auth(token)).send({ contactId });

  const res = await agent().get(`/api/activity?applicationId=${app.id}`).set(auth(token));
  const doc = res.body.items.find((i) => i.action === 'DocumentLinked');
  const contact = res.body.items.find((i) => i.action === 'ContactLinked');
  expect(doc.metadata).toMatchObject({ position: 'Eng', name: 'Resume v2' });
  expect(contact.metadata).toMatchObject({ position: 'Eng', name: 'Jane Recruiter' });
});

test('filters by applicationId and paginates with limit/before', async () => {
  const { token } = await registerAndLogin();
  const app = await makeApp(token, 'Eng');
  for (const status of ['Applied', 'HR_Screening', 'Technical_Interview']) {
    await agent().patch(`/api/applications/${app.id}/status`).set(auth(token)).send({ status });
  }
  const other = await makeApp(token, 'Other');

  const onlyThis = await agent().get(`/api/activity?applicationId=${app.id}`).set(auth(token));
  expect(onlyThis.body.items.every((i) => i.applicationId === app.id)).toBe(true);
  expect(onlyThis.body.items.some((i) => i.metadata.position === 'Other')).toBe(false);

  const page1 = await agent().get('/api/activity?limit=2').set(auth(token));
  expect(page1.body.items).toHaveLength(2);
  expect(page1.body.nextCursor).not.toBeNull();
  const page2 = await agent().get(`/api/activity?limit=2&before=${encodeURIComponent(page1.body.nextCursor)}`).set(auth(token));
  expect(page2.body.items.length).toBeGreaterThan(0);
  expect(new Date(page2.body.items[0].createdAt) <= new Date(page1.body.nextCursor)).toBe(true);
  void other;
});
