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

module.exports = { extractText, MIN_CHARS };
