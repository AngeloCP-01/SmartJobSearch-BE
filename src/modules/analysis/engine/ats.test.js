const { auditAts } = require('./ats');

const GOOD = `John Doe
john.doe@example.com | (555) 123-4567 | linkedin.com/in/johndoe

Summary
Backend engineer with 6 years of experience building scalable APIs.

Experience
Senior Engineer, Acme (2021-2026)
- Built Node.js services handling 1M requests/day
- Led a team of four engineers

Education
B.Sc. Computer Science, State University

Skills
Node.js, PostgreSQL, Docker, REST APIs, communication, leadership`;

test('a well-structured résumé scores high across sub-scores', () => {
  const r = auditAts(GOOD, { mimeType: 'application/pdf' });
  expect(r.subScores.parseability).toBeGreaterThanOrEqual(80);
  expect(r.subScores.contactInfo).toBe(100);
  expect(r.subScores.sections).toBeGreaterThanOrEqual(75);
  expect(r.atsScore).toBeGreaterThanOrEqual(75);
});

test('detects standard sections', () => {
  const r = auditAts(GOOD);
  const present = (name) => r.sectionFindings.find((s) => s.section === name)?.present;
  expect(present('Experience')).toBe(true);
  expect(present('Education')).toBe(true);
  expect(present('Skills')).toBe(true);
});

test('empty / image-like text scores parseability 0', () => {
  const r = auditAts('', { mimeType: 'application/pdf' });
  expect(r.subScores.parseability).toBe(0);
  expect(r.atsScore).toBeLessThan(40);
});

test('missing contact info lowers the contact sub-score', () => {
  const r = auditAts('Experience\nDid some work.\nEducation\nA school.');
  expect(r.subScores.contactInfo).toBeLessThan(100);
});
