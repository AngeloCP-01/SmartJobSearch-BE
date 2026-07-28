#!/usr/bin/env node
// The eval runner: `npm run eval`.
//
// Deliberately NOT part of `npm test`. It makes real model calls, so it is slow,
// costs tokens, and is non-deterministic — three things a test suite must never
// be. The dataset's own guards (evals/dataset.test.js) do run in the suite.
//
// Usage:
//   npm run eval                          all cases, live model calls
//   npm run eval -- --feature=match       one feature
//   npm run eval -- --case=match-aligned-strong
//   npm run eval -- --record              save each case's output to recordings/
//   npm run eval -- --replay              score saved outputs, no model calls
//   npm run eval -- --out=path.json       where to write the artifact
//
// --replay is the loop you want while iterating on scorers: record once, then
// re-score instantly and for free until the checks are right.
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { loadCases, hydrate } = require('./load');
const { SCORERS } = require('./scorers');
const { aggregate, formatReport } = require('./report');
const { tailoringResultSchema } = require('../src/modules/analysis/analysis.schema');
const { aiMatch, generateTextWithFallback, generateJson } = require('../src/modules/analysis/engine/openrouter');
const { coverLetterMessages, tailorMessages } = require('../src/modules/analysis/engine/prompts');
const { SYSTEM: POSTING_SYSTEM, EXTRACT_SCHEMA } = require('../src/modules/postings/postings.service');

const RECORDINGS_DIR = path.join(__dirname, 'recordings');
const RESULTS_DIR = path.join(__dirname, 'results');

function parseArgs(argv) {
  const args = { record: false, replay: false, feature: null, case: null, out: null };
  for (const a of argv) {
    if (a === '--record') args.record = true;
    else if (a === '--replay') args.replay = true;
    else if (a.startsWith('--feature=')) args.feature = a.slice('--feature='.length);
    else if (a.startsWith('--case=')) args.case = a.slice('--case='.length);
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
  }
  return args;
}

// Telemetry the Phase 0 instrumentation attaches to every engine return.
const telemetryOf = (r) => ({
  model: r.model ?? null,
  fallbackDepth: r.fallbackDepth ?? null,
  latencyMs: r.latencyMs ?? null,
  promptTokens: r.usage?.promptTokens ?? null,
  completionTokens: r.usage?.completionTokens ?? null,
  totalTokens: r.usage?.totalTokens ?? null,
});

// Each invoker calls the SAME production prompt the app uses, and returns
// { output, telemetry } where `output` is exactly what the matching scorer
// expects. Anything that would normally require a database (the RAG evidence
// block, the document name) is synthesised here from the case fixtures — the
// point is to exercise the model and the prompt, not Prisma.
const INVOKERS = {
  async match(c) {
    const r = await aiMatch(c.input.resume, c.input.jd);
    return { output: r, telemetry: telemetryOf(r) };
  },

  async 'posting-parse'(c) {
    const r = await generateJson([
      { role: 'system', content: POSTING_SYSTEM },
      { role: 'user', content: `JOB POSTING:\n${c.input.posting}` },
    ], EXTRACT_SCHEMA);
    return { output: r.data, telemetry: telemetryOf(r) };
  },

  async 'cover-letter'(c) {
    const r = await generateTextWithFallback(coverLetterMessages({
      companyName: 'the company',
      position: 'the role',
      jd: c.input.jd,
      resumeText: c.input.resume,
    }));
    // Scored BEFORE humanize() runs. The interesting number is how much
    // correcting the model needed, not what survived the cleanup sweep.
    return { output: r.text, telemetry: telemetryOf(r) };
  },

  async tailor(c) {
    // Stand in for RAG: the résumé itself is the retrieved evidence, labelled
    // with the fixture's filename so the case's groundedInAnyOf can match it.
    const docName = c.sourceName;
    const evidenceBlock = `[from: ${docName}] ${c.input.resume}`;
    const r = await generateJson(
      tailorMessages({ jd: c.input.jd, resumeText: c.input.resume, evidenceBlock }),
      tailoringResultSchema,
    );
    // The RAW suggestions, before the service's groundedIn filter. Scoring the
    // filtered list would measure the filter; we want to measure the model.
    return { output: r.data.suggestions, telemetry: telemetryOf(r) };
  },
};

// The document name a tailor case's evidence is labelled with, derived from the
// fixture path before hydration replaces it with file contents.
function sourceNameFor(rawCase) {
  const ref = rawCase.input.resume || '';
  return ref.startsWith('fixture:') ? path.basename(ref) : 'this résumé';
}

const recordingPath = (id) => path.join(RECORDINGS_DIR, `${id}.json`);

function readRecording(id) {
  const p = recordingPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeRecording(id, payload) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  fs.writeFileSync(recordingPath(id), `${JSON.stringify(payload, null, 2)}\n`);
}

async function runCase(rawCase, args) {
  const c = { ...hydrate(rawCase), sourceName: sourceNameFor(rawCase) };
  const base = { caseId: c.id, feature: c.feature, adversarial: c.adversarial };

  let invocation;
  if (args.replay) {
    const recorded = readRecording(c.id);
    if (!recorded) return { ...base, status: 'skipped', error: 'no recording; run with --record first' };
    invocation = recorded;
  } else {
    try {
      invocation = await INVOKERS[c.feature](c);
    } catch (err) {
      // A provider failure is not a quality failure. Record it as such so a
      // rate-limited run cannot be mistaken for the prompt getting worse.
      return { ...base, status: 'error', passed: false, error: `${err.kind || 'error'}: ${err.message}`.slice(0, 300) };
    }
    if (args.record) writeRecording(c.id, invocation);
  }

  const scored = SCORERS[c.feature](invocation.output, c.expect);
  return { ...base, status: 'scored', ...scored, telemetry: invocation.telemetry };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let cases = loadCases();
  if (args.feature) cases = cases.filter((c) => c.feature === args.feature);
  if (args.case) cases = cases.filter((c) => c.id === args.case);
  if (!cases.length) {
    console.error('No cases matched those filters.');
    process.exit(2);
  }

  if (!args.replay && !process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set. Set it, or use --replay to score saved outputs.');
    process.exit(2);
  }

  console.error(`Running ${cases.length} case(s)${args.replay ? ' from recordings' : ' against the live model'}...`);

  // Sequential on purpose. The provider chain is free-tier and rate-limited;
  // firing 16 concurrent requests is the fastest way to turn a quality run into
  // a 429 run that measures nothing.
  const results = [];
  for (const c of cases) {
    const r = await runCase(c, args); // eslint-disable-line no-await-in-loop
    const mark = r.status === 'scored' ? (r.passed ? 'PASS' : 'FAIL') : r.status.toUpperCase();
    console.error(`  ${mark.padEnd(7)} ${c.id}${r.error ? ` — ${r.error}` : ''}`);
    results.push(r);
  }

  const summary = aggregate(results);
  console.log(`\n${formatReport(summary)}`);

  const out = args.out || path.join(RESULTS_DIR, 'latest.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.error(`\nWrote ${out}`);

  // Exit non-zero only on a real quality failure, never on provider errors —
  // so this can be wired to a nightly job later without paging on a 429.
  process.exit(summary.totals.passRate !== null && summary.totals.passRate < 1 ? 1 : 0);
}

// Only run when invoked as a script. Without this guard, `require`-ing this
// module (as run.test.js does) kicks off a full live eval — which is how the
// first version of that test hung instead of failing.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { parseArgs, sourceNameFor, runCase, INVOKERS };
