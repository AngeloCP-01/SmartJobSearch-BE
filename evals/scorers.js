// Deterministic scorers — the cheap, fast, offline tier of the eval harness.
//
// Everything here is a pure function from (model output, case expectations) to
// a list of named pass/fail checks plus a few metrics. No model is consulted:
// these answer "did the term appear", "was the field null", "was this claim
// fabricated". Subjective quality (is the letter any good?) is the LLM-as-judge
// tier and deliberately does not live here — a deterministic scorer pretending
// to judge tone would be exactly the vibes-based measurement this replaces.
//
// A check is { name, passed, detail }. `name` is stable and greppable so a
// regression can be traced to one assertion rather than a score going down.

// --- term matching -----------------------------------------------------------

// Fold case and punctuation: "Node.js", "node js" and "NodeJS" are one term.
function normalizeTerm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Spelling variants that mean the same skill. Deliberately a small explicit
// table rather than fuzzy/substring matching: substring matching would make
// "java" match "javascript", which would silently pass a fabrication check
// (a JavaScript résumé satisfying a Java requirement) — the exact failure the
// harness exists to catch.
const ALIASES = [
  ['node', 'nodejs'],
  ['postgres', 'postgresql', 'psql'],
  ['kubernetes', 'k8s'],
  ['javascript', 'js'],
  ['typescript', 'ts'],
  ['cicd', 'continuousintegration'],
  ['githubactions', 'ghactions'],
  ['restapi', 'rest', 'restfulapi'],
];

const ALIAS_GROUP = new Map();
for (const group of ALIASES) {
  const canonical = group[0];
  for (const variant of group) ALIAS_GROUP.set(variant, canonical);
}

function canonical(term) {
  const n = normalizeTerm(term);
  return ALIAS_GROUP.get(n) || n;
}

// Is `term` present in `list`? Exact after normalization and alias folding.
function hasTerm(list, term) {
  const want = canonical(term);
  return (list || []).some((item) => canonical(item) === want);
}

// --- shared check plumbing ---------------------------------------------------

const check = (name, passed, detail) => ({ name, passed, detail });

function summarize(checks, metrics = {}) {
  return {
    passed: checks.every((c) => c.passed),
    checks,
    metrics: { checksRun: checks.length, checksFailed: checks.filter((c) => !c.passed).length, ...metrics },
  };
}

// Case-insensitive substring search. Only appropriate where any occurrence is
// meaningful (did the letter mention Node at all?) — NOT for fabrication
// checks, which need claimsTerm below.
const mentions = (haystack, needle) => String(haystack || '').toLowerCase().includes(String(needle).toLowerCase());

// Does the text CLAIM the term, as opposed to merely naming it?
//
// The first live run flagged six fabrications that were every one a false
// positive. The model had written "While I have not yet worked with Kubernetes
// or Terraform in production" and "my professional experience has not yet
// involved Node.js" — honest disclosures — and a bare substring match scored
// them as fabrications. The check penalised the model for exactly the behaviour
// the case was built to reward.
//
// So: look at the window of text before the term. A disclaimer or an aspiration
// disqualifies it; otherwise it counts only if a possession phrase is present.
//
// This is a heuristic and it is meant to be. Deciding whether prose overclaims
// is a judgement call, and the honest place for it is the LLM-as-judge tier
// (Phase 3). What this buys is a cheap, deterministic pre-filter that no longer
// gets the easy cases backwards.
const WINDOW = 90;

// Phrases that turn a nearby term into a non-claim.
const DISCLAIMERS = [
  'not', "n't", 'never', 'without', 'lack', 'unfamiliar', 'no experience', 'yet to',
  'eager to', 'excited to', 'hope to', 'would like to', 'want to', 'looking to',
  'learn', 'learning', 'read about', 'explored', 'exploring', 'curious about',
  'do not demonstrate', 'does not', 'requires', 'the role', 'job asks', 'posting',
];

// Phrases that make a nearby term an assertion about the candidate.
const POSSESSION = [
  'i have', "i've", 'i had', 'i built', 'i build', 'i used', 'i use', 'i worked', 'i work',
  'i ran', 'i run', 'i led', 'i designed', 'i wrote', 'i managed', 'i maintained',
  'my ', 'experience with', 'experience in', 'experienced', 'proficient', 'expert',
  'skilled', 'familiar with', 'fluent in', 'strong in', 'years of',
];

function claimsTerm(text, term) {
  const haystack = String(text || '').toLowerCase();
  const needle = String(term).toLowerCase();

  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const before = haystack.slice(Math.max(0, at - WINDOW), at);
    const disclaimed = DISCLAIMERS.some((d) => before.includes(d));
    // Search the term itself as well as the run-up: a forbidden phrase like
    // "proficient in terraform" already asserts possession, and demanding a
    // separate "I have" in front of it would let the obvious case through.
    const possessed = POSSESSION.some((p) => (before + needle).includes(p));
    // One honest mention elsewhere does not excuse a claim here, so keep
    // scanning every occurrence and report a claim if any of them is one.
    if (!disclaimed && possessed) return true;
    from = at + needle.length;
  }
}

// --- match -------------------------------------------------------------------

// `output` is what aiMatch returns: { matchScore, matched[], missing[] }.
// Extracted JD skills = matched ∪ missing. Present = matched.
function scoreMatch(output, expected) {
  const extracted = [...(output.matched || []), ...(output.missing || [])].map((e) => e.term);
  const present = (output.matched || []).map((e) => e.term);
  const checks = [];

  for (const term of expected.jdSkills.required) {
    checks.push(check(`jd-skill-detected:${term}`, hasTerm(extracted, term), `expected "${term}" among the skills extracted from the JD`));
  }
  for (const term of expected.jdSkills.forbidden) {
    checks.push(check(`jd-skill-not-hallucinated:${term}`, !hasTerm(extracted, term), `"${term}" is not in the job description and must not be extracted`));
  }
  for (const term of expected.present.required) {
    checks.push(check(`present-detected:${term}`, hasTerm(present, term), `expected "${term}" to be recognised in the résumé`));
  }
  // The core fabrication check: a term the résumé does not contain must never
  // be reported as present, however helpful that would feel.
  for (const term of expected.present.forbidden) {
    checks.push(check(`present-not-fabricated:${term}`, !hasTerm(present, term), `"${term}" is absent from the résumé and must not be claimed as present`));
  }
  if (expected.matchScoreRange) {
    const [lo, hi] = expected.matchScoreRange;
    const score = output.matchScore;
    checks.push(check('match-score-in-range', score >= lo && score <= hi, `score ${score} outside the sanity band ${lo}-${hi}`));
  }

  // Two separate recalls, because they answer different questions: did the
  // model READ the job description (jdSkillRecall), and did it correctly find
  // those skills in the résumé (presentRecall). Averaging them into one number
  // hides which half regressed. Null when a case asserts nothing, so an
  // unasserted case can't be mistaken for a perfect score.
  const rate = (wanted, pool) => (wanted.length ? wanted.filter((t) => hasTerm(pool, t)).length / wanted.length : null);

  return summarize(checks, {
    extractedCount: extracted.length,
    presentCount: present.length,
    fabrications: expected.present.forbidden.filter((t) => hasTerm(present, t)).length,
    hallucinatedJdSkills: expected.jdSkills.forbidden.filter((t) => hasTerm(extracted, t)).length,
    jdSkillRecall: rate(expected.jdSkills.required, extracted),
    presentRecall: rate(expected.present.required, present),
  });
}

// --- posting-parse -----------------------------------------------------------

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

function scorePostingParse(output, expected) {
  const checks = [];

  for (const [field, want] of Object.entries(expected.fields)) {
    const got = output ? output[field] : undefined;
    // Containment, not equality: a recovered location may carry extra trailing
    // context ("…, Philippines") and still be correct. Addresses and company
    // names have no java/javascript trap, so this is safe here.
    const passed = !isBlank(got) && mentions(got, want);
    checks.push(check(`field:${field}`, passed, `expected ${field} to contain "${want}", got ${JSON.stringify(got)}`));
  }
  // A posting that states no salary must not acquire one. Inventing a plausible
  // value here is silent data corruption, not a formatting slip.
  for (const field of expected.nullFields) {
    const got = output ? output[field] : undefined;
    checks.push(check(`null-field:${field}`, isBlank(got), `${field} is not stated in the posting but came back as ${JSON.stringify(got)}`));
  }

  return summarize(checks, {
    fabrications: expected.nullFields.filter((f) => !isBlank(output ? output[f] : undefined)).length,
  });
}

// --- tailor ------------------------------------------------------------------

// `suggestions` is the RAW model output, before the service's groundedIn filter
// runs. Scoring the raw list is the point: the filter already protects the user,
// so what we want to measure is how often the model tried to fabricate.
function scoreTailor(suggestions, expected) {
  const list = suggestions || [];
  const checks = [];

  const adds = list.filter((s) => s.kind === 'add');
  const ungrounded = adds.filter((s) => !expected.groundedInAnyOf.some((name) => canonical(name) === canonical(s.groundedIn)));
  if (adds.length) {
    checks.push(check('add-grounded', ungrounded.length === 0, `${ungrounded.length} of ${adds.length} "add" suggestions cite a document that was never retrieved: ${ungrounded.map((s) => s.groundedIn).join(', ')}`));
  }

  const allText = list.map((s) => `${s.text} ${s.why}`).join('\n');
  for (const claim of expected.forbiddenClaims) {
    checks.push(check(`no-forbidden-claim:${claim}`, !claimsTerm(allText, claim), `suggestions must not tell the user to claim "${claim}"`));
  }

  if (expected.maxSuggestions) {
    checks.push(check('max-suggestions', list.length <= expected.maxSuggestions, `${list.length} suggestions exceeds the cap of ${expected.maxSuggestions}`));
  }

  return summarize(checks, {
    suggestionCount: list.length,
    addCount: adds.length,
    ungroundedAdds: ungrounded.length,
    fabrications: ungrounded.length + expected.forbiddenClaims.filter((c) => claimsTerm(allText, c)).length,
  });
}

// --- cover letter + humanizer ------------------------------------------------

// The vocabulary the cover-letter and tailoring prompts explicitly ban. Kept in
// sync with those prompts by hand; a drift here shows up as a suspiciously
// perfect humanizer score, so prefer over-listing to under-listing.
const BANNED_WORDS = [
  'passionate', 'thrilled', 'excited', 'delve', 'leverage', 'robust', 'dynamic', 'vibrant',
  'seamless', 'tapestry', 'testament', 'showcase', 'foster', 'honed', 'spearheaded', 'elevate', 'resonate',
];

// Counts the mechanical "signs of AI writing" the prompts forbid. Run against
// the RAW model text, before humanize() cleans it up — the interesting number is
// how much correcting the model needed, not what survived the sweep.
function humanizerViolations(text) {
  const s = String(text || '');
  // Word-boundary matching so "forest" never counts as "foster".
  const bannedWords = BANNED_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(s));
  const dashes = (s.match(/[—–]/g) || []).length;
  const emoji = (s.match(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/gu) || []).length;
  const curlyQuotes = (s.match(/[“”‘’]/g) || []).length;
  const notOnlyButAlso = (s.match(/not only\b[\s\S]{0,120}?\bbut also\b/gi) || []).length;
  return {
    bannedWords,
    dashes,
    emoji,
    curlyQuotes,
    notOnlyButAlso,
    total: bannedWords.length + dashes + emoji + curlyQuotes + notOnlyButAlso,
  };
}

function scoreCoverLetter(text, expected) {
  const checks = [];

  for (const term of expected.mustMention) {
    checks.push(check(`mentions:${term}`, mentions(text, term), `letter should draw on "${term}" from the résumé`));
  }
  // A cover letter has no groundedIn backstop the way tailoring does, so this is
  // the only place fabrication gets caught for this feature. Naming a gap
  // honestly ("I have not yet worked with Kubernetes") is the behaviour we want,
  // so this asks whether the term is CLAIMED, not whether it appears.
  for (const claim of expected.forbiddenClaims) {
    checks.push(check(`no-forbidden-claim:${claim}`, !claimsTerm(text, claim), `the résumé does not support a claim of "${claim}"`));
  }

  const violations = humanizerViolations(text);
  if (expected.enforceHumanizer) {
    checks.push(check('humanizer-clean', violations.total === 0, `${violations.total} humanizer violations: ${JSON.stringify(violations)}`));
  }

  return summarize(checks, {
    wordCount: String(text || '').trim().split(/\s+/).filter(Boolean).length,
    humanizerViolations: violations.total,
    bannedWords: violations.bannedWords,
    fabrications: expected.forbiddenClaims.filter((c) => claimsTerm(text, c)).length,
  });
}

const SCORERS = {
  match: scoreMatch,
  'posting-parse': scorePostingParse,
  tailor: scoreTailor,
  'cover-letter': scoreCoverLetter,
};

module.exports = {
  normalizeTerm, canonical, hasTerm, claimsTerm, humanizerViolations,
  scoreMatch, scorePostingParse, scoreTailor, scoreCoverLetter, SCORERS, BANNED_WORDS,
};
