const { PDFParse } = require('pdf-parse'); // v2 class API (modern pdfjs)
const mammoth = require('mammoth');
const JSZip = require('jszip');

const MIN_CHARS = 30;
const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MD = 'text/markdown';
const MDX = 'text/x-markdown';
const TXT = 'text/plain';

const SECTION_LABELS = new Set([
  'summary', 'professional summary', 'profile', 'objective', 'career objective',
  'technical skills', 'skills', 'core competencies', 'experience', 'work experience',
  'professional experience', 'employment history', 'projects', 'education',
  'certifications', 'certifications & licenses', 'awards', 'achievements',
  'publications', 'languages', 'interests', 'references', 'volunteer experience',
  'additional information', 'contact',
]);

function normalizeLabel(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, '')                 // strip tags
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim()             // collapse whitespace
    .replace(/:$/, '')                       // drop one trailing colon
    .trim()
    .toLowerCase();
}

async function extractText(buffer, mimeType) {
  try {
    let text = '';
    if (mimeType === PDF) {
      const parser = new PDFParse({ data: buffer });
      try { text = (await parser.getText()).text || ''; }
      finally { await parser.destroy().catch(() => {}); } // release the pdfjs worker/loading task
    } else if (mimeType === DOCX) {
      text = (await mammoth.extractRawText({ buffer })).value || '';
    } else if (mimeType === MD || mimeType === MDX || mimeType === TXT) {
      text = buffer.toString('utf8');
    } else {
      return { text: '', ok: false }; // .doc / unknown
    }
    text = text.trim();
    return { text, ok: text.length >= MIN_CHARS };
  } catch {
    return { text: '', ok: false };
  }
}

// Word often places a résumé's contact block (name / title / email / links) in
// the document PAGE HEADER (word/header*.xml), which mammoth — body-only — drops,
// silently losing the person's identity on import. Recover that text as HTML so
// it isn't lost. Best-effort: returns '' on any problem (never breaks import).
async function extractDocxHeader(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/.test(n)).sort();
    const seen = new Set();
    const lines = [];
    for (const name of names) {
      const xml = await zip.file(name).async('string');
      for (const chunk of xml.split(/<w:p[ >]/).slice(1)) {
        const text = [...chunk.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
          .map((m) => m[1]).join('')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .trim();
        if (text && !seen.has(text)) { seen.add(text); lines.push(text); } // dedupe across header parts
      }
    }
    if (!lines.length) return '';
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const [name, ...rest] = lines; // first line is usually the name → heading
    return `<h1>${esc(name)}</h1>` + rest.map((l) => `<p>${esc(l)}</p>`).join('');
  } catch {
    return '';
  }
}

// Rewrite specific paragraphs of mammoth's DOCX HTML to recover formatting it
// drops. Best-effort: returns the input unchanged on any error (never regresses).
function postProcessDocxHtml(html) {
  try {
    return String(html ?? '').replace(/<p\b[^>]*>([\s\S]*?)<\/p>/g, (whole, inner) => {
      if (SECTION_LABELS.has(normalizeLabel(inner))) {
        return `<h2 data-rule="true">${inner}</h2>`;
      }
      return whole;
    });
  } catch {
    return html;
  }
}

// Like extractText, but preserves structure for the in-app editor:
// DOCX → HTML (mammoth convertToHtml: headings, bold, lists), PDF/markdown/plain
// → raw text. Returns { ok, kind, content } where kind is 'html' or 'text', so
// the frontend knows how to turn it into editor content. Kept separate from
// extractText because résumé keyword-analysis wants flat text, not HTML.
async function extractRich(buffer, mimeType) {
  try {
    if (mimeType === PDF) {
      const parser = new PDFParse({ data: buffer });
      let text = '';
      try { text = (await parser.getText()).text || ''; }
      finally { await parser.destroy().catch(() => {}); }
      text = text.trim();
      return { ok: text.length >= MIN_CHARS, kind: 'text', content: text };
    }
    if (mimeType === DOCX) {
      const headerHtml = await extractDocxHeader(buffer); // recover the page-header contact block
      const body = (await mammoth.convertToHtml({ buffer })).value || '';
      const html = headerHtml + body;
      const textLen = html.replace(/<[^>]+>/g, '').trim().length; // measure real text, not tags
      return { ok: textLen >= MIN_CHARS, kind: 'html', content: html };
    }
    if (mimeType === MD || mimeType === MDX || mimeType === TXT) {
      const text = buffer.toString('utf8').trim();
      return { ok: text.length >= MIN_CHARS, kind: 'text', content: text };
    }
    return { ok: false, kind: 'text', content: '' }; // .doc / unknown
  } catch {
    return { ok: false, kind: 'text', content: '' };
  }
}

module.exports = { extractText, extractRich, extractDocxHeader, normalizeLabel, SECTION_LABELS, MIN_CHARS, postProcessDocxHtml };
