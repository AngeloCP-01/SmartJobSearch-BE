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
