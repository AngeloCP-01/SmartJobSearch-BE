const defaultDict = require('./skills.json');

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

// Only real skills from the curated dictionary are scored — never arbitrary frequent
// JD tokens, which are mostly generic filler ("frameworks", "implement", "what", …) and
// produce junk keywords + nonsensical "add 'what'" suggestions.
function extractJdKeywords(jd, dict) {
  const text = ` ${jd.toLowerCase()} `;
  const found = [];
  for (const s of dict) {
    const c = countSkill(text, dict, s.canonical);
    if (c > 0) found.push({ term: s.canonical, type: s.type, jdCount: c });
  }
  return found;
}

function weightOf(kw) {
  const base = kw.type === 'hard' ? 4 : 2;
  return base + Math.min(kw.jdCount - 1, 4); // frequency bump, capped
}

function matchJd(resumeText, jobDescription, dict = defaultDict) {
  if (!jobDescription || !jobDescription.trim()) return null;
  const resume = ` ${String(resumeText).toLowerCase()} `;
  const keywords = extractJdKeywords(jobDescription, dict);

  const matched = [];
  const missing = [];
  let total = 0;
  let got = 0;

  for (const kw of keywords) {
    const weight = weightOf(kw);
    total += weight;
    const resumeCount = countSkill(resume, dict, kw.term);
    const entry = { term: kw.term, type: kw.type, jdCount: kw.jdCount, resumeCount, weight };
    if (resumeCount > 0) { matched.push(entry); got += weight; } else { missing.push(entry); }
  }

  const matchScore = total === 0 ? 0 : Math.round((got / total) * 100);
  matched.sort((a, b) => b.weight - a.weight);
  missing.sort((a, b) => b.weight - a.weight);
  return { matchScore, matched, missing };
}

module.exports = { matchJd, extractJdKeywords, weightOf };
