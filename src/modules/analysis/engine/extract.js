const { PDFParse } = require('pdf-parse'); // v2 class API (modern pdfjs)
const mammoth = require('mammoth');

const MIN_CHARS = 30;
const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function extractText(buffer, mimeType) {
  try {
    let text = '';
    if (mimeType === PDF) {
      text = (await new PDFParse({ data: buffer }).getText()).text || '';
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
