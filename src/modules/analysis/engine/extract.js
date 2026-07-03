const { PDFParse } = require('pdf-parse'); // v2 class API (modern pdfjs)
const mammoth = require('mammoth');

const MIN_CHARS = 30;
const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MD = 'text/markdown';
const MDX = 'text/x-markdown';
const TXT = 'text/plain';

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
      const html = (await mammoth.convertToHtml({ buffer })).value || '';
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

module.exports = { extractText, extractRich, MIN_CHARS };
