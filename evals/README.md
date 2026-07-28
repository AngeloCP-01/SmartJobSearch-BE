# AI Evals

A golden dataset for the four AI features, plus the loader that validates it.

**Why this exists.** The AI features had no quality measurement at all. Existing
tests cover the *plumbing* thoroughly — retry branches, schema rejection, the
no-fabrication filter — and the *output* not at all. Every prompt tweak and
model-chain change was therefore a leap of faith: nothing could tell you whether
it made results better or worse. This is the fixed input set that makes those
changes measurable.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Token / latency / fallback-depth instrumentation | ✅ shipped (V3-23) |
| 1 | Golden dataset + loader | ✅ shipped (V3-24) |
| **2** | **Deterministic scorers + `npm run eval`** | ✅ **shipped (V3-25)** |
| 3 | LLM-as-judge for subjective quality | ☐ next |
| 4 | Regression gating (nightly, never per-PR) | ☐ |

## Running it

```bash
npm run eval                       # every case, live model calls
npm run eval -- --feature=match    # one feature
npm run eval -- --case=<id>        # one case
npm run eval -- --record           # save each case's output to recordings/
npm run eval -- --replay           # score saved outputs, no model calls
npm run eval -- --out=path.json    # where to write the artifact
```

`--replay` is the loop you want while iterating on scorers: **record once, then
re-score instantly and for free** until the checks are right.

Exits `1` on a quality failure and `0` otherwise — but **never** non-zero purely
because the provider errored, so this can be wired to a nightly job later
without paging on a 429. Cases run sequentially on purpose: the provider chain
is free-tier and rate-limited, and firing them concurrently is the fastest way
to turn a quality run into a 429 run that measures nothing.

`recordings/` is committed (it makes `--replay` reproducible for anyone);
`results/` is gitignored, because a scored run is a point-in-time measurement,
not source.

## Layout

```
evals/
  cases/              one JSON file per feature, each an array of cases
  fixtures/
    resumes/          reusable résumé text
    jds/              reusable job-description text
    postings/         raw pasted job postings (parse feature)
  recordings/         saved model outputs for --replay (committed)
  results/            scored run artifacts (gitignored)
  case.schema.js      Zod schema for a case + per-feature expectations
  load.js             loads, validates, and hydrates cases
  scorers.js          deterministic pass/fail checks per feature
  report.js           aggregation + text rendering
  run.js              the `npm run eval` entry point
  dataset.test.js     guards the dataset — runs in `npm test`, makes no API calls
  scorers.test.js     unit tests for the scorers
  report.test.js      unit tests for aggregation
  run.test.js         unit tests for the runner's CLI logic
```

## What gets measured

| Metric | Why it's here |
|---|---|
| **Pass rate** | Headline, but the least interesting number on its own |
| **Adversarial pass rate** | Reported separately — a run can look healthy overall while every honesty case is red |
| **Fabrications** | The headline honesty number. Any value above zero is worth a look regardless of pass rate |
| Per-check failures | Named and listed. "Pass rate fell to 60%" isn't actionable; `present-not-fabricated:terraform failed on match-stretch-senior` is |
| Ungrounded adds | How often the model *tried* to fabricate, counted before the engine's `groundedIn` filter drops it — the filter protects the user, this measures the prompt |
| Humanizer violations | Counted on the **raw** text, before `humanize()` cleans it — the interesting number is how much correcting the model needed |
| Tokens / latency / fallback depth | From the Phase 0 instrumentation, carried through per case |

**Errored cases are counted separately from failing ones.** The model never
answered, so the quality question is unanswered — folding the two together is
how a provider outage gets misread as the prompt getting worse.

The scorers deliberately check only what a machine can check without another
model's opinion: did the term appear, was the field null, was this claim
fabricated. Subjective quality is Phase 3. A deterministic scorer pretending to
judge tone would be exactly the vibes-based measurement this replaces.

`dataset.test.js` deliberately runs in the normal suite: it is fast, offline and
deterministic, and it stops a malformed or unexplained case from being committed.
The scoring run that actually calls a model will be `npm run eval` (Phase 2) and
stays out of CI, because it is slow, costs tokens and is non-deterministic.

## Anatomy of a case

```json
{
  "id": "match-domain-mismatch",
  "feature": "match",
  "rationale": "Why this case is in the set, in a sentence or two.",
  "adversarial": true,
  "input": {
    "resume": "fixture:resumes/graphic-designer.txt",
    "jd": "fixture:jds/node-backend-senior.txt"
  },
  "expect": {
    "jdSkills": { "required": ["node.js"], "forbidden": [] },
    "present":  { "required": [], "forbidden": ["node.js", "kubernetes"] },
    "matchScoreRange": [0, 20]
  }
}
```

- **`input` values** are either literal text or `fixture:<path>` pointers into
  `fixtures/`. A missing fixture throws — it never falls through as literal text,
  because a typo'd path would otherwise become a "job description" reading
  `fixture:jds/typo.txt` and the case would silently measure nothing.
- **`rationale` is required** and length-checked. An unexplained case is one
  nobody can maintain or safely delete a year from now.
- **`adversarial`** marks cases designed to make the model fail. The suite
  asserts every feature still has at least one. A dataset of only happy paths
  measures nothing interesting — it is exactly the vibes-based eval it replaces.
- **Every expectation is optional.** A case asserts only what it can honestly
  assert; a half-specified case beats a hand-waved one, and even an empty
  `expect` still measures schema validity.

### `forbidden` is the important half

`required` lists check competence. **`forbidden` lists check honesty** — they are
the fabrication assertions, and they are the reason this dataset is worth having.
`present.forbidden` on the domain-mismatch case says: a graphic designer's résumé
must never be reported as containing Kubernetes, no matter how much the model
wants to be helpful.

## Expectations by feature

| Feature | Fields |
|---|---|
| `match` | `jdSkills.{required,forbidden}` — terms extracted from the JD · `present.{required,forbidden}` — terms claimed to be in the résumé · `matchScoreRange` (sanity band, not a target) |
| `posting-parse` | `fields` — exact values to recover · `nullFields` — fields that must come back null |
| `tailor` | `groundedInAnyOf` — document names an `add` may cite · `forbiddenClaims` · `maxSuggestions` |
| `cover-letter` | `mustMention` · `forbiddenClaims` · `enforceHumanizer` |

## Adding a case

1. Drop long input text in `fixtures/` (or inline it if short).
2. Append a case to the matching `cases/<feature>.json`.
3. `npm test` — `dataset.test.js` validates shape, uniqueness, fixture
   resolution and rationale.

**Grow this set from production failures.** Every genuinely bad output you see in
real use should become a permanent case here. That is what keeps a golden set
honest over time — otherwise it only ever tests the failures you could imagine up
front, which are not the ones that bite you.

## Current coverage

16 cases: 6 `match`, 4 `posting-parse`, 3 `tailor`, 3 `cover-letter` —
10 of them adversarial.

**These are synthetic.** They were written to cover specific failure modes
(domain mismatch, thin résumé, boilerplate JD, degenerate input, Taglish/emoji
posting noise, missing fields that must stay null, the gap-fabrication
temptation). Real résumés and real job descriptions should be layered in
alongside them — a golden set built from actual production inputs reflects the
distribution that matters, which synthetic cases can only approximate.
