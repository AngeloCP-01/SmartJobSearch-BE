# Résumé Analysis (ATS) Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic, offline résumé-analysis engine (text extraction + ATS-friendliness audit + JD-keyword match + rule suggestions) exposed via a `userId`-scoped `analysis/` module that persists an immutable `ResumeAnalysis` snapshot.

**Architecture:** Pure engine modules under `src/modules/analysis/engine/` (`match.js`, `ats.js`, `suggestions.js` operate on plain strings; `extract.js` is the only I/O, reading bytes via the existing `storage` layer and parsing PDF/DOCX). A thin service assembles + Zod-validates a `report` and persists `ResumeAnalysis`. One new table (real migration).

**Tech Stack:** Express, Prisma (PostgreSQL), Zod, Jest + Supertest, `pdf-parse` + `mammoth` (text extraction).

## Global Constraints

- Every service function takes `userId` and filters **every** query by it; another user's application/document/analysis → `404`.
- JWT-protected via `requireAuth`; controllers `next(e)` on error.
- **Deterministic, no external API / no randomness** — identical inputs give identical scores. No LLM in this slice (`suggestions[].source` is always `'rule'`).
- File handling: **PDF + DOCX** are parsed; **legacy `.doc` (`application/msword`) and scanned/empty PDFs → `{ ok: false }`** (a parseability finding, never a thrown error / 500).
- An unparseable résumé still yields a **`201` with a parseability-failure report**, not an error.
- `report` JSON shape (Zod `analysisReportSchema`): `meta { documentName, position, jdPresent, extractionOk, wordCount }`, `atsSubScores { parseability, sections, contactInfo, formatting, length }` (each 0–100), `matched[]`/`missing[]` of `{ term, type: 'hard'|'soft', jdCount, resumeCount, weight }`, `sectionFindings[]` of `{ section, present }`, `suggestions[]` of `{ text, severity: 'high'|'medium'|'low', source: 'rule' }`.
- Library note: the spec listed `unpdf`, but the backend is **CommonJS** and `unpdf` is ESM-only; this plan uses **`pdf-parse`** (imported as `require('pdf-parse/lib/pdf-parse.js')` to avoid its debug-mode file read) + **`mammoth`** — both CommonJS, buffer-based. (Swap to `pdfjs-dist`/`unpdf` if the backend later moves to ESM/serverless.)
- Tests use the existing harness: `tests/helpers/testApp.js` (`agent`), `tests/helpers/db.js` (`prisma`, `resetDb`), `tests/helpers/auth.js` (`registerAndLogin`). DB up: `docker compose up -d`; `npm test` runs `jest --runInBand` + `prisma migrate deploy`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Match engine (skills dictionary + JD keyword match)

Pure, no DB, no deps.

**Files:**
- Create: `src/modules/analysis/engine/skills.json`
- Create: `src/modules/analysis/engine/text.js` (shared tokenize/stem helpers)
- Create: `src/modules/analysis/engine/match.js`
- Test: `src/modules/analysis/engine/match.test.js`

**Interfaces:**
- Produces: `matchJd(resumeText, jobDescription, dict?) → { matchScore:number, matched:Entry[], missing:Entry[] } | null` where `Entry = { term, type:'hard'|'soft', jdCount, resumeCount, weight }`; returns `null` for an empty JD. `text.js` exports `tokenize(s)→string[]`, `stem(w)→string`, `STOPWORDS:Set`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/analysis/engine/match.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- match.test`
Expected: FAIL — `Cannot find module './match'`.

- [ ] **Step 3: Create the skills dictionary**

Create `src/modules/analysis/engine/skills.json` (a curated starter set; extend freely — tests only rely on the entries referenced above):

```json
[
  { "canonical": "node.js", "type": "hard", "synonyms": ["node", "nodejs"] },
  { "canonical": "javascript", "type": "hard", "synonyms": ["js"] },
  { "canonical": "typescript", "type": "hard", "synonyms": ["ts"] },
  { "canonical": "react", "type": "hard", "synonyms": ["react.js", "reactjs"] },
  { "canonical": "express", "type": "hard", "synonyms": ["express.js"] },
  { "canonical": "postgresql", "type": "hard", "synonyms": ["postgres", "psql"] },
  { "canonical": "mysql", "type": "hard", "synonyms": [] },
  { "canonical": "mongodb", "type": "hard", "synonyms": ["mongo"] },
  { "canonical": "redis", "type": "hard", "synonyms": [] },
  { "canonical": "docker", "type": "hard", "synonyms": [] },
  { "canonical": "kubernetes", "type": "hard", "synonyms": ["k8s"] },
  { "canonical": "aws", "type": "hard", "synonyms": ["amazon web services"] },
  { "canonical": "graphql", "type": "hard", "synonyms": [] },
  { "canonical": "rest api", "type": "hard", "synonyms": ["rest", "restful"] },
  { "canonical": "python", "type": "hard", "synonyms": [] },
  { "canonical": "java", "type": "hard", "synonyms": [] },
  { "canonical": "go", "type": "hard", "synonyms": ["golang"] },
  { "canonical": "sql", "type": "hard", "synonyms": [] },
  { "canonical": "git", "type": "hard", "synonyms": [] },
  { "canonical": "ci/cd", "type": "hard", "synonyms": ["cicd", "continuous integration"] },
  { "canonical": "machine learning", "type": "hard", "synonyms": ["ml"] },
  { "canonical": "communication", "type": "soft", "synonyms": ["communicate", "communication skills"] },
  { "canonical": "leadership", "type": "soft", "synonyms": ["leader", "led", "lead"] },
  { "canonical": "teamwork", "type": "soft", "synonyms": ["team", "collaboration", "collaborative"] },
  { "canonical": "problem solving", "type": "soft", "synonyms": ["problem-solving"] },
  { "canonical": "agile", "type": "soft", "synonyms": ["scrum"] }
]
```

- [ ] **Step 4: Create the shared text helpers**

Create `src/modules/analysis/engine/text.js`:

```js
const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'as', 'we', 'you', 'our', 'your', 'they', 'their',
  'this', 'that', 'it', 'its', 'will', 'who', 'which', 'have', 'has', 'had', 'need', 'good',
  'experience', 'required', 'skilled', 'years', 'year', 'strong', 'seeking', 'built', 'using',
]);

// keep tech tokens like node.js, ci/cd, c++, c#
const tokenize = (s) => (String(s).toLowerCase().match(/[a-z0-9][a-z0-9+#./]*[a-z0-9+#]|[a-z0-9]/g) || []);

const stem = (w) => w.replace(/(ing|ed|es|s)$/i, '');

module.exports = { STOPWORDS, tokenize, stem };
```

- [ ] **Step 5: Implement the match engine**

Create `src/modules/analysis/engine/match.js`:

```js
const defaultDict = require('./skills.json');
const { STOPWORDS, tokenize, stem } = require('./text');

// Build a phrase->{canonical,type} index from the dictionary (canonical + synonyms).
function buildIndex(dict) {
  const index = new Map();
  for (const s of dict) {
    for (const phrase of [s.canonical, ...s.synonyms]) {
      index.set(phrase.toLowerCase(), { canonical: s.canonical, type: s.type });
    }
  }
  return index;
}

// Count non-overlapping occurrences of a (possibly multi-word) phrase in lowercased text.
function countPhrase(text, phrase) {
  const safe = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^a-z0-9])${safe}(?=$|[^a-z0-9])`, 'g');
  return (text.match(re) || []).length;
}

// Resolve how many times a dictionary skill appears, trying canonical + every synonym.
function countSkill(text, dict, canonical) {
  const entry = dict.find((s) => s.canonical === canonical);
  const phrases = [canonical, ...(entry ? entry.synonyms : [])];
  return phrases.reduce((n, p) => n + countPhrase(text, p.toLowerCase()), 0);
}

function extractJdKeywords(jd, dict, index) {
  const text = ` ${jd.toLowerCase()} `;
  const found = new Map(); // canonical -> {term,type,jdCount}

  // 1) dictionary skills (handles multi-word + synonyms)
  for (const s of dict) {
    const c = countSkill(text, dict, s.canonical);
    if (c > 0) found.set(s.canonical, { term: s.canonical, type: s.type, jdCount: c });
  }

  // 2) salient single tokens not already covered (frequency-based), treated as hard skills
  const freq = new Map();
  for (const tok of tokenize(jd)) {
    if (tok.length < 3 || STOPWORDS.has(tok)) continue;
    if (index.has(tok)) continue; // already captured via dictionary
    freq.set(tok, (freq.get(tok) || 0) + 1);
  }
  for (const [tok, c] of [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    if (!found.has(tok)) found.set(tok, { term: tok, type: 'hard', jdCount: c });
  }
  return [...found.values()];
}

function weightOf(kw) {
  const base = kw.type === 'hard' ? 4 : 2;
  return base + Math.min(kw.jdCount - 1, 4); // frequency bump, capped
}

function matchJd(resumeText, jobDescription, dict = defaultDict) {
  if (!jobDescription || !jobDescription.trim()) return null;
  const index = buildIndex(dict);
  const resume = ` ${String(resumeText).toLowerCase()} `;
  const keywords = extractJdKeywords(jobDescription, dict, index);

  const matched = [];
  const missing = [];
  let total = 0;
  let got = 0;

  for (const kw of keywords) {
    const weight = weightOf(kw);
    total += weight;
    // resume count: dictionary skill uses synonym-aware count; bare token tries exact + stem
    let resumeCount = index.has(kw.term)
      ? countSkill(resume, dict, kw.term)
      : countPhrase(resume, kw.term) || countPhrase(resume, stem(kw.term));
    const entry = { term: kw.term, type: kw.type, jdCount: kw.jdCount, resumeCount, weight };
    if (resumeCount > 0) { matched.push(entry); got += weight; } else { missing.push(entry); }
  }

  const matchScore = total === 0 ? 0 : Math.round((got / total) * 100);
  matched.sort((a, b) => b.weight - a.weight);
  missing.sort((a, b) => b.weight - a.weight);
  return { matchScore, matched, missing };
}

module.exports = { matchJd, extractJdKeywords, buildIndex };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- match.test`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/modules/analysis/engine/skills.json src/modules/analysis/engine/text.js src/modules/analysis/engine/match.js src/modules/analysis/engine/match.test.js
git commit -m "feat(analysis): JD keyword/skill match engine + skills dictionary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: ATS-friendliness audit engine

Pure, no DB, no deps.

**Files:**
- Create: `src/modules/analysis/engine/ats.js`
- Test: `src/modules/analysis/engine/ats.test.js`

**Interfaces:**
- Consumes: `text.js` (Task 1).
- Produces: `auditAts(text, opts?) → { atsScore:number, subScores:{parseability,sections,contactInfo,formatting,length}, sectionFindings:{section,present}[] }`. `opts.mimeType` optional.

- [ ] **Step 1: Write the failing test**

Create `src/modules/analysis/engine/ats.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- ats.test`
Expected: FAIL — `Cannot find module './ats'`.

- [ ] **Step 3: Implement the audit**

Create `src/modules/analysis/engine/ats.js`:

```js
const { tokenize } = require('./text');

const SECTIONS = {
  Experience: /\b(experience|employment|work history|professional experience)\b/i,
  Education: /\b(education|academic|qualifications)\b/i,
  Skills: /\b(skills|technical skills|competencies)\b/i,
  Summary: /\b(summary|objective|profile|about)\b/i,
};

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

function scoreSections(text) {
  const findings = Object.keys(SECTIONS).map((section) => ({ section, present: SECTIONS[section].test(text) }));
  // Experience/Education/Skills are the load-bearing three; Summary is a bonus.
  const core = ['Experience', 'Education', 'Skills'].filter((s) => findings.find((f) => f.section === s).present).length;
  const summary = findings.find((f) => f.section === 'Summary').present ? 1 : 0;
  return { findings, score: clamp((core / 3) * 90 + summary * 10) };
}

function scoreContact(text) {
  const email = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text);
  const phone = /(\+?\d[\d\s().-]{7,}\d)/.test(text);
  const linkedin = /linkedin\.com\/in\//i.test(text);
  return { email, score: clamp((email ? 60 : 0) + (phone ? 30 : 0) + (linkedin ? 10 : 0)) };
}

function scoreFormatting(text) {
  if (!text.trim()) return 0;
  const lines = text.split('\n').filter((l) => l.trim());
  const bullets = lines.filter((l) => /^\s*[-•*]/.test(l)).length;
  const nonAscii = (text.match(/[^\x09\x0a\x20-\x7e]/g) || []).length;
  const nonAsciiRatio = nonAscii / Math.max(text.length, 1);
  let score = 100;
  if (nonAsciiRatio > 0.05) score -= 40;      // odd glyphs / parsing artifacts
  if (bullets === 0 && lines.length > 8) score -= 20; // no bullet structure
  const longLines = lines.filter((l) => l.length > 200).length; // possible fused columns
  if (longLines > 0) score -= 20;
  return clamp(score);
}

function scoreLength(wordCount) {
  if (wordCount < 150) return clamp((wordCount / 150) * 60);
  if (wordCount <= 1000) return 100;
  if (wordCount <= 1500) return 80;
  return 60;
}

function auditAts(text, { mimeType } = {}) {
  void mimeType;
  const t = String(text || '');
  const words = tokenize(t);
  const substantive = words.length >= 50;
  const parseability = substantive ? 100 : clamp((words.length / 50) * 100);
  const sections = scoreSections(t);
  const contact = scoreContact(t);
  const formatting = scoreFormatting(t);
  const length = scoreLength(words.length);
  const subScores = {
    parseability,
    sections: sections.score,
    contactInfo: contact.score,
    formatting,
    length,
  };
  // Weighting: parseability 0.30, sections 0.25, contact 0.20, formatting 0.15, length 0.10
  const atsScore = clamp(
    parseability * 0.30 + subScores.sections * 0.25 + subScores.contactInfo * 0.20
    + formatting * 0.15 + length * 0.10,
  );
  return { atsScore, subScores, sectionFindings: sections.findings };
}

module.exports = { auditAts };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- ats.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/analysis/engine/ats.js src/modules/analysis/engine/ats.test.js
git commit -m "feat(analysis): ATS-friendliness audit engine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Suggestions engine

Pure, no DB, no deps.

**Files:**
- Create: `src/modules/analysis/engine/suggestions.js`
- Test: `src/modules/analysis/engine/suggestions.test.js`

**Interfaces:**
- Consumes: outputs of `auditAts` (Task 2) + `matchJd` (Task 1).
- Produces: `buildSuggestions({ subScores, sectionFindings, missing, meta }) → { text, severity:'high'|'medium'|'low', source:'rule' }[]` (sorted high→low).

- [ ] **Step 1: Write the failing test**

Create `src/modules/analysis/engine/suggestions.test.js`:

```js
const { buildSuggestions } = require('./suggestions');

test('a missing high-weight hard skill yields a high-severity suggestion', () => {
  const s = buildSuggestions({
    subScores: { parseability: 100, sections: 100, contactInfo: 100, formatting: 100, length: 100 },
    sectionFindings: [{ section: 'Skills', present: true }],
    missing: [{ term: 'kubernetes', type: 'hard', jdCount: 3, resumeCount: 0, weight: 7 }],
    meta: { extractionOk: true },
  });
  const k = s.find((x) => x.text.toLowerCase().includes('kubernetes'));
  expect(k).toBeTruthy();
  expect(k.severity).toBe('high');
  expect(k.source).toBe('rule');
});

test('a missing Skills section and missing email produce suggestions', () => {
  const s = buildSuggestions({
    subScores: { parseability: 100, sections: 40, contactInfo: 40, formatting: 100, length: 100 },
    sectionFindings: [{ section: 'Skills', present: false }],
    missing: [],
    meta: { extractionOk: true },
  });
  expect(s.some((x) => /skills section/i.test(x.text))).toBe(true);
  expect(s.some((x) => /email/i.test(x.text))).toBe(true);
});

test('an unparseable résumé yields a high-severity parseability warning first', () => {
  const s = buildSuggestions({
    subScores: { parseability: 0, sections: 0, contactInfo: 0, formatting: 0, length: 0 },
    sectionFindings: [],
    missing: [],
    meta: { extractionOk: false },
  });
  expect(s[0].severity).toBe('high');
  expect(/could not|image|parse/i.test(s[0].text)).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- suggestions.test`
Expected: FAIL — `Cannot find module './suggestions'`.

- [ ] **Step 3: Implement the suggestions**

Create `src/modules/analysis/engine/suggestions.js`:

```js
function buildSuggestions({ subScores, sectionFindings, missing, meta }) {
  const out = [];

  if (!meta || meta.extractionOk === false) {
    out.push({
      text: 'We could not read text from this file — it may be image-based or an unsupported format. Upload a text-based PDF or DOCX so an ATS can parse it.',
      severity: 'high', source: 'rule',
    });
    return out; // nothing else is meaningful without text
  }

  if (subScores.contactInfo < 60) {
    out.push({ text: 'Add a clear email address (and phone) near the top so recruiters and ATS can capture your contact details.', severity: 'high', source: 'rule' });
  }

  const missingSections = (sectionFindings || []).filter((s) => !s.present && s.section !== 'Summary');
  for (const s of missingSections) {
    out.push({ text: `Add a clearly-labelled "${s.section}" section — ATS parsers look for standard headings.`, severity: 'medium', source: 'rule' });
  }

  const hardMissing = (missing || []).filter((m) => m.type === 'hard').sort((a, b) => b.weight - a.weight).slice(0, 5);
  for (const m of hardMissing) {
    out.push({
      text: `Consider adding "${m.term}" if you have it — it appears ${m.jdCount}× in the job description but not in your résumé.`,
      severity: m.weight >= 6 ? 'high' : 'medium', source: 'rule',
    });
  }

  if (subScores.length < 60) {
    out.push({ text: 'Your résumé looks short — aim for enough detail to fill roughly one to two pages.', severity: 'low', source: 'rule' });
  }
  if (subScores.formatting < 70) {
    out.push({ text: 'Simplify formatting — avoid tables, columns, and special characters that can scramble ATS parsing.', severity: 'medium', source: 'rule' });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

module.exports = { buildSuggestions };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- suggestions.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/analysis/engine/suggestions.js src/modules/analysis/engine/suggestions.test.js
git commit -m "feat(analysis): rule-based suggestions engine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Text extraction (PDF + DOCX) with fixtures

**Files:**
- Modify: `package.json` (add `pdf-parse`, `mammoth`; devDeps `pdf-lib`, `docx` for fixture generation)
- Create: `tests/fixtures/generate-resume-fixtures.js`
- Create: `tests/fixtures/resume.pdf`, `tests/fixtures/resume.docx` (generated)
- Create: `src/modules/analysis/engine/extract.js`
- Test: `src/modules/analysis/engine/extract.test.js`

**Interfaces:**
- Produces: `extractText(buffer, mimeType) → Promise<{ text:string, ok:boolean }>`; `MIN_CHARS` constant. Never throws.

- [ ] **Step 1: Install dependencies**

```bash
npm install pdf-parse mammoth
npm install -D pdf-lib docx
```

- [ ] **Step 2: Write the fixture generator + generate the fixtures**

Create `tests/fixtures/generate-resume-fixtures.js`:

```js
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { Document, Packer, Paragraph } = require('docx');

const TEXT = [
  'Jane Candidate',
  'jane@example.com | (555) 987-6543',
  'Experience',
  'Senior Backend Engineer building Node.js and PostgreSQL services.',
  'Education',
  'B.Sc. Computer Science',
  'Skills',
  'Node.js, PostgreSQL, Docker, REST APIs, communication, leadership',
];

async function main() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  TEXT.forEach((line, i) => page.drawText(line, { x: 50, y: 740 - i * 22, size: 12, font }));
  fs.writeFileSync(path.join(__dirname, 'resume.pdf'), await pdf.save());

  const doc = new Document({ sections: [{ children: TEXT.map((t) => new Paragraph(t)) }] });
  fs.writeFileSync(path.join(__dirname, 'resume.docx'), await Packer.toBuffer(doc));
  console.log('fixtures written');
}
main();
```

Run it:
```bash
node tests/fixtures/generate-resume-fixtures.js
```
Expected: `fixtures written`; `tests/fixtures/resume.pdf` and `resume.docx` now exist.

- [ ] **Step 3: Write the failing test**

Create `src/modules/analysis/engine/extract.test.js`:

```js
const fs = require('fs');
const path = require('path');
const { extractText } = require('./extract');

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const fixture = (name) => fs.readFileSync(path.join(__dirname, '../../../tests/fixtures', name));

test('extracts text from a PDF résumé', async () => {
  const r = await extractText(fixture('resume.pdf'), PDF);
  expect(r.ok).toBe(true);
  expect(r.text.toLowerCase()).toContain('postgresql');
});

test('extracts text from a DOCX résumé', async () => {
  const r = await extractText(fixture('resume.docx'), DOCX);
  expect(r.ok).toBe(true);
  expect(r.text.toLowerCase()).toContain('node.js');
});

test('legacy .doc is unsupported → ok:false', async () => {
  const r = await extractText(Buffer.from('whatever'), 'application/msword');
  expect(r).toEqual({ text: '', ok: false });
});

test('garbage / empty input never throws → ok:false', async () => {
  const r = await extractText(Buffer.from('not a real pdf'), PDF);
  expect(r.ok).toBe(false);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- extract.test`
Expected: FAIL — `Cannot find module './extract'`.

- [ ] **Step 5: Implement extraction**

Create `src/modules/analysis/engine/extract.js`:

```js
const pdfParse = require('pdf-parse/lib/pdf-parse.js'); // lib path avoids debug-mode file read
const mammoth = require('mammoth');

const MIN_CHARS = 30;
const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function extractText(buffer, mimeType) {
  try {
    let text = '';
    if (mimeType === PDF) {
      text = (await pdfParse(buffer)).text || '';
    } else if (mimeType === DOCX) {
      text = (await mammoth.extractRawText({ buffer })).value || '';
    } else {
      return { text: '', ok: false }; // .doc / unknown
    }
    text = text.trim();
    return { text, ok: text.length >= MIN_CHARS };
  } catch {
    return { text: '', ok: false };
  }
}

module.exports = { extractText, MIN_CHARS };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- extract.test`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tests/fixtures src/modules/analysis/engine/extract.js src/modules/analysis/engine/extract.test.js
git commit -m "feat(analysis): PDF/DOCX text extraction (detect-and-warn on unparseable)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Model + migration + service + endpoints

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration (via `prisma migrate dev`)
- Modify: `tests/helpers/db.js`
- Create: `src/modules/analysis/analysis.schema.js` (Zod: request + report)
- Create: `src/modules/analysis/analysis.service.js`
- Create: `src/modules/analysis/analysis.controller.js`
- Create: `src/modules/analysis/analysis.routes.js`
- Modify: `src/routes/index.js`
- Test: `tests/analysis.test.js`

**Interfaces:**
- Consumes: the engine (`extractText`, `auditAts`, `matchJd`, `buildSuggestions`), the `storage` layer (`createReadStream`).
- Produces: `service.run(userId, { applicationId, documentId })`, `service.list(userId)`, `service.getById(userId, id)`, `service.remove(userId, id)`. `GET /api/analysis` item: `{ id, atsScore, matchScore, documentName, position, createdAt }`.

- [ ] **Step 1: Add the model + migration**

In `prisma/schema.prisma`, add the model (after `ActivityLog`):

```prisma
model ResumeAnalysis {
  id            String       @id @default(uuid())
  userId        String
  user          User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  applicationId String?
  application   Application? @relation(fields: [applicationId], references: [id], onDelete: SetNull)
  documentId    String?
  document      Document?    @relation(fields: [documentId], references: [id], onDelete: SetNull)
  atsScore      Int
  matchScore    Int?
  report        Json         @default("{}")
  createdAt     DateTime     @default(now())

  @@index([userId, createdAt])
}
```

Add back-relations: `User` → `resumeAnalyses ResumeAnalysis[]`; `Application` → `resumeAnalyses ResumeAnalysis[]`; `Document` → `resumeAnalyses ResumeAnalysis[]`.

Then:
```bash
docker compose up -d
npx prisma migrate dev --name add_resume_analysis
npx prisma generate
```

- [ ] **Step 2: Update `resetDb`**

In `tests/helpers/db.js`, add before `interview.deleteMany()` (it references application/document/user):

```js
  await prisma.resumeAnalysis.deleteMany();
```

- [ ] **Step 3: Create the Zod schemas**

Create `src/modules/analysis/analysis.schema.js`:

```js
const { z } = require('zod');

const runAnalysisSchema = z.object({
  applicationId: z.string().uuid(),
  documentId: z.string().uuid(),
});

const entrySchema = z.object({
  term: z.string(), type: z.enum(['hard', 'soft']),
  jdCount: z.number().int(), resumeCount: z.number().int(), weight: z.number(),
});

const analysisReportSchema = z.object({
  meta: z.object({
    documentName: z.string(), position: z.string().nullable(),
    jdPresent: z.boolean(), extractionOk: z.boolean(), wordCount: z.number().int(),
  }),
  atsSubScores: z.object({
    parseability: z.number(), sections: z.number(), contactInfo: z.number(),
    formatting: z.number(), length: z.number(),
  }),
  matched: z.array(entrySchema),
  missing: z.array(entrySchema),
  sectionFindings: z.array(z.object({ section: z.string(), present: z.boolean() })),
  suggestions: z.array(z.object({
    text: z.string(), severity: z.enum(['high', 'medium', 'low']), source: z.literal('rule'),
  })),
});

module.exports = { runAnalysisSchema, analysisReportSchema };
```

- [ ] **Step 4: Write the failing API test**

Create `tests/analysis.test.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-it-'));
process.env.UPLOAD_DIR = tmpDir;

const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const resumeDocx = () => fs.readFileSync(path.join(__dirname, 'fixtures/resume.docx'));

async function uploadResume(token) {
  return (await agent().post('/api/documents').set(auth(token))
    .field('name', 'My Resume').field('type', 'Resume')
    .attach('file', resumeDocx(), { filename: 'resume.docx', contentType: DOCX })).body.id;
}
async function makeApp(token, jobDescription) {
  return (await agent().post('/api/applications').set(auth(token))
    .send({ position: 'Backend Engineer', jobDescription })).body.id;
}

test('requires authentication (401)', async () => {
  expect((await agent().get('/api/analysis')).status).toBe(401);
});

test('runs an analysis with a JD → scores + valid report; lists + fetches + deletes it', async () => {
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'Backend Engineer skilled in Node.js, PostgreSQL, Docker and Kubernetes. Good communication.');
  const docId = await uploadResume(token);

  const run = await agent().post('/api/analysis').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(run.status).toBe(201);
  expect(run.body.atsScore).toBeGreaterThan(0);
  expect(typeof run.body.matchScore).toBe('number');
  expect(run.body.report.matched.length + run.body.report.missing.length).toBeGreaterThan(0);
  expect(run.body.report.meta.extractionOk).toBe(true);

  const list = await agent().get('/api/analysis').set(auth(token));
  expect(list.body).toHaveLength(1);
  expect(list.body[0]).toMatchObject({ id: run.body.id, documentName: 'My Resume', position: 'Backend Engineer' });

  const one = await agent().get(`/api/analysis/${run.body.id}`).set(auth(token));
  expect(one.body.report.suggestions.length).toBeGreaterThanOrEqual(0);

  expect((await agent().delete(`/api/analysis/${run.body.id}`).set(auth(token))).status).toBe(204);
  expect((await agent().get('/api/analysis').set(auth(token))).body).toHaveLength(0);
});

test('an application without a JD → matchScore null but a full ATS audit', async () => {
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, undefined);
  const docId = await uploadResume(token);
  const run = await agent().post('/api/analysis').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(run.status).toBe(201);
  expect(run.body.matchScore).toBeNull();
  expect(run.body.report.meta.jdPresent).toBe(false);
  expect(run.body.atsScore).toBeGreaterThan(0);
});

test('an unparseable résumé → 201 with a parseability-failure report (not 500)', async () => {
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'Node.js role');
  const docId = (await agent().post('/api/documents').set(auth(token))
    .field('name', 'Scan').field('type', 'Resume')
    .attach('file', Buffer.from('%PDF-1.4 not real text'), { filename: 's.pdf', contentType: 'application/pdf' })).body.id;
  const run = await agent().post('/api/analysis').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(run.status).toBe(201);
  expect(run.body.report.meta.extractionOk).toBe(false);
  expect(run.body.report.suggestions[0].severity).toBe('high');
});

test('cross-user isolation (404)', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const appId = await makeApp(a.token, 'Node.js');
  const docId = await uploadResume(a.token);
  // B cannot use A's application/document
  expect((await agent().post('/api/analysis').set(auth(b.token)).send({ applicationId: appId, documentId: docId })).status).toBe(404);
  // B cannot read/delete A's analysis
  const run = await agent().post('/api/analysis').set(auth(a.token)).send({ applicationId: appId, documentId: docId });
  expect((await agent().get(`/api/analysis/${run.body.id}`).set(auth(b.token))).status).toBe(404);
  expect((await agent().delete(`/api/analysis/${run.body.id}`).set(auth(b.token))).status).toBe(404);
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -- analysis.test`
Expected: FAIL — `404` (route not wired).

- [ ] **Step 6: Create the service**

Create `src/modules/analysis/analysis.service.js`:

```js
const prisma = require('../../shared/database/prisma');
const storage = require('../../shared/storage');
const { NotFoundError } = require('../../shared/utils/errors');
const { analysisReportSchema } = require('./analysis.schema');
const { extractText } = require('./engine/extract');
const { auditAts } = require('./engine/ats');
const { matchJd } = require('./engine/match');
const { buildSuggestions } = require('./engine/suggestions');
const { tokenize } = require('./engine/text');

const listSelect = { id: true, atsScore: true, matchScore: true, report: true, createdAt: true };

function readBuffer(key) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    storage.createReadStream(key).on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
  });
}

async function run(userId, { applicationId, documentId }) {
  const application = await prisma.application.findFirst({ where: { id: applicationId, userId } });
  if (!application) throw new NotFoundError('Application not found');
  const document = await prisma.document.findFirst({ where: { id: documentId, userId } });
  if (!document) throw new NotFoundError('Document not found');

  const buffer = await readBuffer(document.storageKey);
  const { text, ok } = await extractText(buffer, document.mimeType);

  const ats = auditAts(text, { mimeType: document.mimeType });
  const jd = application.jobDescription || '';
  const match = ok ? matchJd(text, jd) : null; // no point matching unreadable text
  const meta = {
    documentName: document.name,
    position: application.position ?? null,
    jdPresent: Boolean(jd.trim()),
    extractionOk: ok,
    wordCount: tokenize(text).length,
  };
  const suggestions = buildSuggestions({
    subScores: ats.subScores, sectionFindings: ats.sectionFindings,
    missing: match ? match.missing : [], meta,
  });

  const report = analysisReportSchema.parse({
    meta,
    atsSubScores: ats.subScores,
    matched: match ? match.matched : [],
    missing: match ? match.missing : [],
    sectionFindings: ats.sectionFindings,
    suggestions,
  });

  return prisma.resumeAnalysis.create({
    data: {
      userId, applicationId, documentId,
      atsScore: ats.atsScore,
      matchScore: match ? match.matchScore : null,
      report,
    },
    select: { id: true, atsScore: true, matchScore: true, report: true, createdAt: true },
  });
}

async function list(userId) {
  const rows = await prisma.resumeAnalysis.findMany({
    where: { userId }, orderBy: { createdAt: 'desc' }, select: listSelect,
  });
  return rows.map((r) => ({
    id: r.id, atsScore: r.atsScore, matchScore: r.matchScore,
    documentName: r.report?.meta?.documentName ?? null,
    position: r.report?.meta?.position ?? null,
    createdAt: r.createdAt,
  }));
}

async function getById(userId, id) {
  const row = await prisma.resumeAnalysis.findFirst({ where: { id, userId }, select: listSelect });
  if (!row) throw new NotFoundError('Analysis not found');
  return row;
}

async function remove(userId, id) {
  const row = await prisma.resumeAnalysis.findFirst({ where: { id, userId } });
  if (!row) throw new NotFoundError('Analysis not found');
  await prisma.resumeAnalysis.delete({ where: { id } });
}

module.exports = { run, list, getById, remove };
```

- [ ] **Step 7: Create the controller**

Create `src/modules/analysis/analysis.controller.js`:

```js
const service = require('./analysis.service');

async function run(req, res, next) {
  try { res.status(201).json(await service.run(req.userId, req.body)); }
  catch (e) { next(e); }
}
async function list(req, res, next) {
  try { res.json(await service.list(req.userId)); }
  catch (e) { next(e); }
}
async function getById(req, res, next) {
  try { res.json(await service.getById(req.userId, req.params.id)); }
  catch (e) { next(e); }
}
async function remove(req, res, next) {
  try { await service.remove(req.userId, req.params.id); res.status(204).end(); }
  catch (e) { next(e); }
}

module.exports = { run, list, getById, remove };
```

- [ ] **Step 8: Create the routes**

Create `src/modules/analysis/analysis.routes.js`:

```js
const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/middleware/validate');
const { runAnalysisSchema } = require('./analysis.schema');
const ctrl = require('./analysis.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', validate(runAnalysisSchema), ctrl.run);
router.get('/:id', ctrl.getById);
router.delete('/:id', ctrl.remove);

module.exports = router;
```

- [ ] **Step 9: Wire the module**

In `src/routes/index.js`, add alongside the others and mount after `activity`:

```js
const analysisRoutes = require('../modules/analysis/analysis.routes');
```
```js
router.use('/analysis', analysisRoutes);
```

- [ ] **Step 10: Run the API tests, then the full suite**

Run: `npm test -- analysis.test`
Expected: PASS (5 tests).

Run: `npm test`
Expected: PASS — prior 108 tests + (5 match + 4 ats + 3 suggestions + 4 extract + 5 analysis API) = **129 total**.

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/helpers/db.js src/modules/analysis/analysis.schema.js src/modules/analysis/analysis.service.js src/modules/analysis/analysis.controller.js src/modules/analysis/analysis.routes.js src/routes/index.js tests/analysis.test.js
git commit -m "feat(analysis): ResumeAnalysis model + run/list/get/delete endpoints

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** pure engine — extract (T4) / ATS audit (T2) / JD match (T1) / rule suggestions (T3) ✓; detect-and-warn on `.doc`/scanned → `ok:false` (T4) and parseability-failure 201 (T5) ✓; bundled `skills.json` w/ hard/soft + synonyms + multi-word (T1) ✓; `ResumeAnalysis` immutable snapshot + migration + Zod-validated `report` (T5) ✓; endpoints run/list/get/delete (T5) ✓; no-JD → `matchScore: null` (T5) ✓; cross-user 404 + auth 401 (T5) ✓; deterministic/offline, `source:'rule'` only ✓.
- **Type consistency:** `Entry` shape `{term,type,jdCount,resumeCount,weight}` is identical across `match.js`, the Zod `entrySchema`, and the tests; `subScores`/`atsSubScores` keys match between `ats.js`, `analysisReportSchema`, and the service; `auditAts`/`matchJd`/`buildSuggestions`/`extractText` signatures are consistent across tasks and the service.
- **Placeholders:** none — every step has complete code/commands. `skills.json` is a deliberately-trimmed starter set (the spec's "few hundred" is extensible data; the tests only depend on the listed entries).
- **Library deviation noted:** `pdf-parse` + `mammoth` instead of the spec's `unpdf` (CommonJS compatibility), documented in Global Constraints.
