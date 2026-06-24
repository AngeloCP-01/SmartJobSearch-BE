const { matchJd } = require('./match');

const RESUME = 'Backend engineer with 5 years of Node.js, Express and PostgreSQL. Built REST APIs and led a team. Strong communication skills.';
const JD = 'We need a Backend Engineer skilled in Node.js, PostgreSQL and Kubernetes. Docker experience required. Good communication and leadership.';

test('returns null when the JD is empty', () => {
  expect(matchJd(RESUME, '')).toBeNull();
  expect(matchJd(RESUME, '   ')).toBeNull();
});

test('classifies matched vs missing keywords from the JD', () => {
  const r = matchJd(RESUME, JD);
  const terms = (list) => list.map((e) => e.term);
  expect(terms(r.matched)).toEqual(expect.arrayContaining(['node.js', 'postgresql']));
  expect(terms(r.missing)).toEqual(expect.arrayContaining(['kubernetes', 'docker']));
});

test('recognizes multi-word skills and counts occurrences', () => {
  const r = matchJd('I have machine learning experience.', 'Seeking machine learning and machine learning ops.');
  const ml = r.matched.find((e) => e.term === 'machine learning');
  expect(ml).toBeTruthy();
  expect(ml.jdCount).toBeGreaterThanOrEqual(2);
  expect(ml.resumeCount).toBeGreaterThanOrEqual(1);
});

test('multi-word skills do not leak their component tokens as phantom skills', () => {
  const r = matchJd('I cook.', 'We want machine learning and amazon web services.');
  const terms = r.matched.concat(r.missing).map((e) => e.term);
  expect(terms).toContain('machine learning');
  // component fragments must not appear as standalone keywords
  expect(terms).not.toContain('machine');
  expect(terms).not.toContain('learning');
  expect(terms).not.toContain('web');
  expect(terms).not.toContain('services');
});

test('hard skills weigh more than soft skills, and the score is 0..100', () => {
  const r = matchJd(RESUME, JD);
  const hard = r.matched.concat(r.missing).find((e) => e.term === 'kubernetes');
  const soft = r.matched.concat(r.missing).find((e) => e.term === 'communication');
  expect(hard.type).toBe('hard');
  expect(soft.type).toBe('soft');
  expect(hard.weight).toBeGreaterThan(soft.weight);
  expect(r.matchScore).toBeGreaterThanOrEqual(0);
  expect(r.matchScore).toBeLessThanOrEqual(100);
});

test('a résumé that covers more of the JD scores higher', () => {
  const weak = matchJd('I cook food.', JD).matchScore;
  const strong = matchJd(RESUME + ' Docker and Kubernetes too.', JD).matchScore;
  expect(strong).toBeGreaterThan(weak);
});
