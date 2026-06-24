const fs = require('fs');
const path = require('path');
const { extractText } = require('./extract');

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const fixture = (name) => fs.readFileSync(path.join(__dirname, '../../../../tests/fixtures', name));

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
