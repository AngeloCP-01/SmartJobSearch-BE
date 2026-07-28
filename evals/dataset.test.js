// Guards the golden dataset itself. Runs in the normal `npm test` suite because
// it makes no API calls — it only proves the committed cases are well-formed,
// resolvable, and still cover the adversarial ground they were written for.
// The scoring run that actually calls a model is `npm run eval`, kept out of CI.
const {
  loadCases, hydrate, resolveText, FEATURES,
} = require('./load');
const { caseSchema } = require('./case.schema');

describe('golden dataset', () => {
  const cases = loadCases();

  test('loads a non-empty set of cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test('every committed case validates against the case schema', () => {
    for (const c of cases) expect(() => caseSchema.parse(c)).not.toThrow();
  });

  test('case ids are unique', () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every feature the engine exposes has at least one case', () => {
    for (const feature of FEATURES) {
      expect(cases.some((c) => c.feature === feature)).toBe(true);
    }
  });

  // The adversarial cases are the point. A dataset of only happy paths measures
  // nothing interesting — it is exactly the "vibes-based" eval it replaces.
  test('every feature has at least one adversarial case', () => {
    for (const feature of FEATURES) {
      expect(cases.some((c) => c.feature === feature && c.adversarial)).toBe(true);
    }
  });

  test('every case explains why it exists', () => {
    for (const c of cases) expect(c.rationale.length).toBeGreaterThan(20);
  });

  // Regression guard. The first draft of these cases asserted `company`,
  // `location`, `salary` and `title` — none of which exist in EXTRACT_SCHEMA
  // (the real fields are position, companyName, salaryMin, salaryMax,
  // workMode, jobDescription). Those cases would have run happily and measured
  // nothing. A case that names a field the schema does not have is a silent
  // no-op that reads as a pass, so it fails the build instead.
  test('posting-parse cases only reference fields that exist in EXTRACT_SCHEMA', () => {
    const { EXTRACT_SCHEMA } = require('../src/modules/postings/postings.service');
    const known = Object.keys(EXTRACT_SCHEMA.shape);
    for (const c of cases.filter((x) => x.feature === 'posting-parse')) {
      const referenced = [...Object.keys(c.expect.fields || {}), ...(c.expect.nullFields || [])];
      for (const field of referenced) {
        expect({ case: c.id, field, known }).toMatchObject({ field: expect.stringMatching(new RegExp(`^(${known.join('|')})$`)) });
      }
    }
  });

  test('every fixture reference resolves to non-empty text', () => {
    for (const c of cases) {
      for (const value of Object.values(c.input)) {
        if (typeof value === 'string') expect(resolveText(value).trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('case schema', () => {
  const valid = {
    id: 'match-example',
    feature: 'match',
    rationale: 'a rationale long enough to be meaningful',
    input: { resume: 'r', jd: 'j' },
    expect: {},
  };

  test('accepts a minimal well-formed case', () => {
    expect(() => caseSchema.parse(valid)).not.toThrow();
  });

  test('rejects an unknown feature', () => {
    expect(() => caseSchema.parse({ ...valid, feature: 'telepathy' })).toThrow();
  });

  test('rejects a match case missing its job description', () => {
    expect(() => caseSchema.parse({ ...valid, input: { resume: 'r' } })).toThrow();
  });

  test('defaults adversarial to false', () => {
    expect(caseSchema.parse(valid).adversarial).toBe(false);
  });
});

// hydrate() is what the scoring runner consumes: a case with its fixture
// pointers turned into real text and its expectations defaulted, so a scorer can
// read `.expect.jdSkills.required` without null-guarding every access.
describe('hydrate', () => {
  const raw = {
    id: 'match-hydrate',
    feature: 'match',
    rationale: 'exercises fixture resolution and expectation defaulting',
    input: { resume: 'fixture:resumes/thin-junior.txt', jd: 'inline jd text' },
    expect: { jdSkills: { required: ['node.js'] } },
  };

  test('replaces fixture references with the file contents', () => {
    expect(hydrate(caseSchema.parse(raw)).input.resume).toContain('DELA CRUZ');
  });

  test('leaves inline input text alone', () => {
    expect(hydrate(caseSchema.parse(raw)).input.jd).toBe('inline jd text');
  });

  test('fills in the expectation defaults the case left out', () => {
    const h = hydrate(caseSchema.parse(raw));
    expect(h.expect.jdSkills).toEqual({ required: ['node.js'], forbidden: [] });
    expect(h.expect.present).toEqual({ required: [], forbidden: [] });
  });

  test('every committed case hydrates without throwing', () => {
    for (const c of loadCases()) expect(() => hydrate(c)).not.toThrow();
  });
});

describe('resolveText', () => {
  test('returns inline text unchanged', () => {
    expect(resolveText('a literal job description')).toBe('a literal job description');
  });

  test('reads a fixture: reference off disk', () => {
    expect(resolveText('fixture:resumes/node-backend-mid.txt')).toContain('Node');
  });

  test('throws on a missing fixture rather than silently returning the reference', () => {
    expect(() => resolveText('fixture:resumes/does-not-exist.txt')).toThrow(/fixture/i);
  });
});
