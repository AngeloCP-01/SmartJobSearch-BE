// The shape of one golden-dataset case.
//
// A case is a frozen input plus the assertions that must hold over the model's
// output. The assertions are deliberately *deterministic* — things a scorer can
// check without another model's opinion (did this term appear, was this field
// null, was this claim fabricated). Subjective quality (tone, usefulness) is the
// LLM-as-judge tier and is not encoded here.
//
// Every expectation field is optional and defaults to empty: a case asserts only
// what it can honestly assert. A half-specified case is better than a
// hand-waved one, and an empty `expect` still measures schema validity.
const { z } = require('zod');

// A term list checked case-insensitively by the scorers.
const terms = z.array(z.string().min(1)).default([]);

// Required = must appear. Forbidden = must NOT appear; every forbidden entry is
// a fabrication check, which is the metric that matters most here.
const requiredForbidden = z.object({ required: terms, forbidden: terms }).default({});

const matchExpect = z.object({
  // Skills the model extracts FROM THE JOB DESCRIPTION.
  jdSkills: requiredForbidden,
  // Of those, the ones it marks present=true (i.e. claims to find in the résumé).
  // `present.forbidden` is the core fabrication check: a term the résumé does
  // not contain must never be reported as present.
  present: requiredForbidden,
  // Sanity band, not a target. A score outside it means the run is wrong in a
  // way term-level checks can miss (e.g. everything marked present).
  matchScoreRange: z.tuple([z.number(), z.number()]).optional(),
}).default({});

const postingParseExpect = z.object({
  // Exact field values the parse must recover, compared case-insensitively.
  fields: z.record(z.string()).default({}),
  // Fields that must come back null. A posting that omits a salary must not
  // acquire one — inventing a plausible value is the failure mode here.
  nullFields: z.array(z.string()).default([]),
}).default({});

const tailorExpect = z.object({
  // Every `add` suggestion must cite one of these document names. The engine
  // already drops ungrounded adds; the eval counts how often it had to.
  groundedInAnyOf: terms,
  // Substrings that must not appear anywhere in the suggestions — claims the
  // source documents do not support.
  forbiddenClaims: terms,
  maxSuggestions: z.number().int().positive().optional(),
}).default({});

const coverLetterExpect = z.object({
  // Facts from the résumé the letter should actually use.
  mustMention: terms,
  // Claims the résumé does not support. The model must not reach for these.
  forbiddenClaims: terms,
  // Checked against the humanizer rules the prompts already encode.
  enforceHumanizer: z.boolean().default(true),
}).default({});

const EXPECT_BY_FEATURE = {
  match: matchExpect,
  'posting-parse': postingParseExpect,
  tailor: tailorExpect,
  'cover-letter': coverLetterExpect,
};

// Input shapes differ per feature; each is validated so a case can't silently
// omit the thing the runner needs (a match case with no JD would run, produce
// garbage, and look like a model failure).
const INPUT_BY_FEATURE = {
  match: z.object({ resume: z.string().min(1), jd: z.string().min(1) }),
  'posting-parse': z.object({ posting: z.string().min(1) }),
  tailor: z.object({ resume: z.string().min(1), jd: z.string().min(1) }),
  'cover-letter': z.object({ resume: z.string().min(1), jd: z.string().min(1) }),
};

const FEATURES = Object.keys(EXPECT_BY_FEATURE);

const caseSchema = z.object({
  id: z.string().min(1),
  feature: z.enum(['match', 'posting-parse', 'tailor', 'cover-letter']),
  // Why this case is in the set. Enforced to a real length because an
  // unexplained case is one nobody can maintain or safely delete later.
  rationale: z.string().min(21),
  // Adversarial cases are the ones designed to make the model fail. Tracked
  // explicitly so the suite can assert the set keeps covering them.
  adversarial: z.boolean().default(false),
  input: z.record(z.string()),
  expect: z.record(z.unknown()).default({}),
}).superRefine((c, ctx) => {
  const input = INPUT_BY_FEATURE[c.feature];
  const expected = EXPECT_BY_FEATURE[c.feature];
  if (!input || !expected) return; // unknown feature already reported by the enum
  const inputResult = input.safeParse(c.input);
  if (!inputResult.success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['input'], message: `invalid input for feature "${c.feature}": ${inputResult.error.message}` });
  }
  const expectResult = expected.safeParse(c.expect);
  if (!expectResult.success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expect'], message: `invalid expectations for feature "${c.feature}": ${expectResult.error.message}` });
  }
});

// Parse `expect` with the feature-specific schema so defaults are applied —
// the scorers can then read `.jdSkills.required` without null-guarding.
function normalizeExpect(c) {
  return EXPECT_BY_FEATURE[c.feature].parse(c.expect);
}

module.exports = { caseSchema, normalizeExpect, FEATURES };
