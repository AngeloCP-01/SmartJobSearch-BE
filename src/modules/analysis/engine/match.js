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
    const resumeCount = index.has(kw.term)
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
