const {
  normalizeTerm, hasTerm, scoreMatch, scorePostingParse, scoreTailor, scoreCoverLetter, humanizerViolations,
} = require('./scorers');

// --- term matching -----------------------------------------------------------
// Every skill check rests on this. Too strict and the scores are noise; too
// loose and the fabrication checks stop meaning anything.

describe('normalizeTerm', () => {
  test('folds case and punctuation so Node.js, node js and NodeJS are one term', () => {
    expect(normalizeTerm('Node.js')).toBe(normalizeTerm('node js'));
    expect(normalizeTerm('NodeJS')).toBe(normalizeTerm('Node.js'));
  });
});

describe('hasTerm', () => {
  test('matches across spelling variants of the same skill', () => {
    expect(hasTerm(['Node.js', 'PostgreSQL'], 'nodejs')).toBe(true);
    expect(hasTerm(['Postgres'], 'postgresql')).toBe(true);
    expect(hasTerm(['K8s'], 'kubernetes')).toBe(true);
  });

  test('does NOT match java against javascript', () => {
    // The trap that rules out substring matching: a résumé full of JavaScript
    // must never satisfy a Java requirement, and a "java" fabrication check
    // must not be tripped by the model correctly reporting JavaScript.
    expect(hasTerm(['JavaScript'], 'java')).toBe(false);
    expect(hasTerm(['Java'], 'javascript')).toBe(false);
  });

  test('does not match unrelated terms', () => {
    expect(hasTerm(['Node.js', 'Redis'], 'kubernetes')).toBe(false);
  });
});

// --- match feature -----------------------------------------------------------

const matchOutput = ({ matched = [], missing = [], matchScore = 50 }) => ({
  matchScore,
  matched: matched.map((term) => ({ term, type: 'hard', weight: 4 })),
  missing: missing.map((term) => ({ term, type: 'hard', weight: 4 })),
  suggestions: [],
});

describe('scoreMatch', () => {
  const expectations = {
    jdSkills: { required: ['node.js', 'postgresql'], forbidden: ['kubernetes'] },
    present: { required: ['node.js'], forbidden: ['terraform'] },
    matchScoreRange: [40, 80],
  };

  test('passes when the model extracted and placed every term correctly', () => {
    const r = scoreMatch(matchOutput({ matched: ['Node.js'], missing: ['PostgreSQL', 'Terraform'] }), expectations);
    expect(r.passed).toBe(true);
    expect(r.checks.every((c) => c.passed)).toBe(true);
  });

  test('fails when a required JD skill was never extracted', () => {
    const r = scoreMatch(matchOutput({ matched: ['Node.js'], missing: [] }), expectations);
    expect(r.passed).toBe(false);
    expect(r.checks.find((c) => c.name === 'jd-skill-detected:postgresql').passed).toBe(false);
  });

  test('flags a hallucinated JD skill the posting never mentioned', () => {
    const r = scoreMatch(matchOutput({ matched: ['Node.js'], missing: ['PostgreSQL', 'Kubernetes'] }), expectations);
    expect(r.checks.find((c) => c.name === 'jd-skill-not-hallucinated:kubernetes').passed).toBe(false);
  });

  // The single most important check in the whole harness.
  test('flags a fabrication: a skill claimed present that the résumé lacks', () => {
    const r = scoreMatch(matchOutput({ matched: ['Node.js', 'Terraform'], missing: ['PostgreSQL'] }), expectations);
    const fabrication = r.checks.find((c) => c.name === 'present-not-fabricated:terraform');
    expect(fabrication.passed).toBe(false);
    expect(r.metrics.fabrications).toBe(1);
  });

  test('flags a match score outside its sanity band', () => {
    const r = scoreMatch(matchOutput({ matched: ['Node.js'], missing: ['PostgreSQL', 'Terraform'], matchScore: 99 }), expectations);
    expect(r.checks.find((c) => c.name === 'match-score-in-range').passed).toBe(false);
  });

  test('reports recall over the required terms', () => {
    const r = scoreMatch(matchOutput({ matched: ['Node.js'], missing: [] }), expectations);
    expect(r.metrics.jdSkillRecall).toBeCloseTo(0.5);
  });

  test('an empty expectation set still scores, asserting nothing', () => {
    const r = scoreMatch(matchOutput({ matched: [], missing: [] }), { jdSkills: { required: [], forbidden: [] }, present: { required: [], forbidden: [] } });
    expect(r.passed).toBe(true);
    expect(r.checks).toHaveLength(0);
  });
});

// --- posting-parse feature ---------------------------------------------------

describe('scorePostingParse', () => {
  const expectations = { fields: { company: 'Sablay Digital' }, nullFields: ['salary', 'location'] };

  test('passes when stated fields are recovered and absent ones stay null', () => {
    const r = scorePostingParse({ company: 'Sablay Digital', salary: null, location: null }, expectations);
    expect(r.passed).toBe(true);
  });

  test('accepts a field value that contains the expected value', () => {
    const r = scorePostingParse({ company: 'Sablay Digital Inc.', salary: null, location: null }, expectations);
    expect(r.checks.find((c) => c.name === 'field:company').passed).toBe(true);
  });

  // Inventing a plausible salary is data corruption, not a formatting slip.
  test('flags an invented value in a field the posting never stated', () => {
    const r = scorePostingParse({ company: 'Sablay Digital', salary: 'Php 60,000 - 80,000', location: null }, expectations);
    expect(r.checks.find((c) => c.name === 'null-field:salary').passed).toBe(false);
    expect(r.metrics.fabrications).toBe(1);
  });

  test('treats an empty string as null for a field that must be absent', () => {
    const r = scorePostingParse({ company: 'Sablay Digital', salary: '   ', location: null }, expectations);
    expect(r.checks.find((c) => c.name === 'null-field:salary').passed).toBe(true);
  });

  test('flags a wrong value for a field the posting did state', () => {
    const r = scorePostingParse({ company: 'Some Other Corp', salary: null, location: null }, expectations);
    expect(r.checks.find((c) => c.name === 'field:company').passed).toBe(false);
  });
});

// --- tailor feature ----------------------------------------------------------

const suggestion = (over = {}) => ({
  kind: 'emphasize', text: 'Lead with the Redis queue work.', why: 'The job asks for queues.', groundedIn: 'this résumé', anchor: 'BullMQ queue', severity: 'high', ...over,
});

describe('scoreTailor', () => {
  const expectations = { groundedInAnyOf: ['node-backend-mid.txt'], forbiddenClaims: ['proficient in terraform'], maxSuggestions: 12 };

  test('passes when every add cites a real retrieved document', () => {
    const r = scoreTailor([suggestion(), suggestion({ kind: 'add', groundedIn: 'node-backend-mid.txt', anchor: '' })], expectations);
    expect(r.passed).toBe(true);
    expect(r.metrics.ungroundedAdds).toBe(0);
  });

  // The engine drops these server-side; the eval counts how often it had to,
  // which is the real signal about how honest the prompt is.
  test('counts an add citing a document that was never retrieved', () => {
    const r = scoreTailor([suggestion({ kind: 'add', groundedIn: 'imaginary-cert.pdf', anchor: '' })], expectations);
    expect(r.checks.find((c) => c.name === 'add-grounded').passed).toBe(false);
    expect(r.metrics.ungroundedAdds).toBe(1);
  });

  test('does not require grounding for non-add suggestions', () => {
    const r = scoreTailor([suggestion({ kind: 'rephrase', groundedIn: 'this résumé' })], expectations);
    expect(r.metrics.ungroundedAdds).toBe(0);
  });

  test('flags a forbidden claim appearing in a suggestion', () => {
    const r = scoreTailor([suggestion({ text: 'Say you are proficient in Terraform.' })], expectations);
    expect(r.checks.find((c) => c.name === 'no-forbidden-claim:proficient in terraform').passed).toBe(false);
  });

  test('flags exceeding the suggestion cap', () => {
    const r = scoreTailor(Array.from({ length: 13 }, () => suggestion()), expectations);
    expect(r.checks.find((c) => c.name === 'max-suggestions').passed).toBe(false);
  });
});

// --- cover-letter feature ----------------------------------------------------

describe('humanizerViolations', () => {
  test('catches AI-tell vocabulary the prompt bans', () => {
    const v = humanizerViolations('I am thrilled to leverage my robust experience.');
    expect(v.bannedWords).toEqual(expect.arrayContaining(['thrilled', 'leverage', 'robust']));
  });

  test('matches banned vocabulary case-insensitively and on word boundaries only', () => {
    expect(humanizerViolations('Passionate about this.').bannedWords).toContain('passionate');
    // "foster" is banned; "fostering" as part of a longer word should not
    // trip a separate false positive on an unrelated word like "forest".
    expect(humanizerViolations('We walked through the forest.').bannedWords).toEqual([]);
  });

  test('counts em dashes and en dashes', () => {
    expect(humanizerViolations('I built it — quickly – twice.').dashes).toBe(2);
  });

  test('counts emoji', () => {
    expect(humanizerViolations('Great work 🎉 really 🔥').emoji).toBe(2);
  });

  test('catches the not-only-but-also construction', () => {
    expect(humanizerViolations('Not only did I ship it, but also I tested it.').notOnlyButAlso).toBe(1);
  });

  test('clean prose produces no violations', () => {
    const v = humanizerViolations('I built the shipment API in Node.js. It handled 400 requests per second.');
    expect(v.total).toBe(0);
  });
});

describe('scoreCoverLetter', () => {
  const expectations = { mustMention: ['node'], forbiddenClaims: ['kubernetes'], enforceHumanizer: true };

  test('passes on a grounded, clean letter', () => {
    const r = scoreCoverLetter('I built the shipment API in Node.js and tuned its Postgres queries.', expectations);
    expect(r.passed).toBe(true);
  });

  test('flags a claim the résumé does not support', () => {
    const r = scoreCoverLetter('I have run Kubernetes clusters in production, and I use Node.js daily.', expectations);
    expect(r.checks.find((c) => c.name === 'no-forbidden-claim:kubernetes').passed).toBe(false);
    expect(r.metrics.fabrications).toBe(1);
  });

  test('flags a required mention the letter omitted', () => {
    const r = scoreCoverLetter('I write backend services and enjoy the work.', expectations);
    expect(r.checks.find((c) => c.name === 'mentions:node').passed).toBe(false);
  });

  test('flags humanizer violations when enforced', () => {
    const r = scoreCoverLetter('I am thrilled to leverage Node.js here.', expectations);
    expect(r.checks.find((c) => c.name === 'humanizer-clean').passed).toBe(false);
    expect(r.metrics.humanizerViolations).toBeGreaterThan(0);
  });

  test('skips the humanizer check when a case opts out', () => {
    const r = scoreCoverLetter('I am thrilled to use Node.js.', { ...expectations, enforceHumanizer: false });
    expect(r.checks.some((c) => c.name === 'humanizer-clean')).toBe(false);
  });
});
