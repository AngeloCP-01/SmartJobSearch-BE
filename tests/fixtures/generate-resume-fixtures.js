const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { Document, Packer, Paragraph } = require('docx');

const TEXT = [
  'Jane Candidate',
  'jane@example.com | (555) 987-6543',
  'Experience',
  'Senior Backend Engineer building Node.js and PostgreSQL services.',
  'Education',
  'B.Sc. Computer Science',
  'Skills',
  'Node.js, PostgreSQL, Docker, REST APIs, communication, leadership',
];

async function main() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  TEXT.forEach((line, i) => page.drawText(line, { x: 50, y: 740 - i * 22, size: 12, font }));
  // useObjectStreams:false → an uncompressed PDF that pdf-parse v1's pdfjs can read
  fs.writeFileSync(path.join(__dirname, 'resume.pdf'), await pdf.save({ useObjectStreams: false }));

  const doc = new Document({ sections: [{ children: TEXT.map((t) => new Paragraph(t)) }] });
  fs.writeFileSync(path.join(__dirname, 'resume.docx'), await Packer.toBuffer(doc));
  console.log('fixtures written');
}
main();
