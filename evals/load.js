// Loads the golden dataset off disk and validates it.
//
// Cases are plain JSON so they are diffable in review and editable without
// touching code — a golden set that requires a programmer to extend stops
// growing. Long inputs live in evals/fixtures/ and are referenced as
// "fixture:<path>" so the same résumé can back several cases.
const fs = require('fs');
const path = require('path');
const { caseSchema, normalizeExpect, FEATURES } = require('./case.schema');

const CASES_DIR = path.join(__dirname, 'cases');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const FIXTURE_PREFIX = 'fixture:';

// An input value is either literal text or a pointer into evals/fixtures/.
// A missing fixture throws rather than falling through as literal text —
// otherwise a typo'd path becomes a "job description" reading
// "fixture:jds/typo.txt" and the case silently measures nothing.
function resolveText(value) {
  if (!value.startsWith(FIXTURE_PREFIX)) return value;
  const rel = value.slice(FIXTURE_PREFIX.length);
  const abs = path.join(FIXTURES_DIR, rel);
  // Keep a typo'd or hostile "../" reference inside the fixtures tree.
  if (!abs.startsWith(FIXTURES_DIR + path.sep)) throw new Error(`fixture escapes the fixtures directory: ${rel}`);
  if (!fs.existsSync(abs)) throw new Error(`fixture not found: ${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

function readCaseFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${path.basename(file)} is not valid JSON: ${e.message}`);
  }
}

// Every case file under evals/cases/, validated. Throws on the first bad case
// with its filename attached — a dataset that half-loads is worse than one that
// refuses to, because the missing cases look like passing ones.
function loadCases() {
  if (!fs.existsSync(CASES_DIR)) return [];
  const files = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')).sort();
  return files.flatMap((f) => {
    const abs = path.join(CASES_DIR, f);
    const parsed = readCaseFile(abs);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map((c) => {
      const result = caseSchema.safeParse(c);
      if (!result.success) throw new Error(`${f}: case "${c && c.id}" is invalid — ${result.error.message}`);
      return result.data;
    });
  });
}

// A case with its fixture pointers resolved to real text and its expectations
// defaulted — what the scoring runner consumes. Defaulting here means a scorer
// can read `.expect.jdSkills.required` without null-guarding every access.
function hydrate(testCase) {
  const input = Object.fromEntries(
    Object.entries(testCase.input).map(([k, v]) => [k, resolveText(v)]),
  );
  return { ...testCase, input, expect: normalizeExpect(testCase) };
}

module.exports = {
  loadCases, hydrate, resolveText, FEATURES, CASES_DIR, FIXTURES_DIR,
};
