const fs = require('fs');
const path = require('path');
const { extractText } = require('./extract');

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const fixture = (name) => fs.readFileSync(path.join(__dirname, '../../../../tests/fixtures', name));

// Runs under Jest's `--experimental-vm-modules` sandbox with pdf-parse v2
// (modern pdf.js). An earlier pdf-parse version failed to initialize its
// worker/loading task inside this sandbox and returned ok:false, so this was
// skipped; ^2.4.5 initializes correctly here, matching real-Node behavior.
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

test('extracts raw text from a markdown file', async () => {
  const md = Buffer.from('# Backend Engineer\n\nExperienced with **Node.js** and PostgreSQL.');
  const r = await extractText(md, 'text/markdown');
  expect(r.ok).toBe(true);
  expect(r.text).toContain('# Backend Engineer');
  expect(r.text).toContain('**Node.js**');
});
