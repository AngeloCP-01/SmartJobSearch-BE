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
