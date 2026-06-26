/* eslint-disable no-console */
// Seeds (or re-seeds) the public DEMO account with realistic, portfolio-grade
// data so a reviewer can click "Try the demo" and land in a populated app.
//
// Re-runnable: it wipes the demo user's existing data first, then recreates it.
// Run against whatever DATABASE_URL / STORAGE_DRIVER are in the environment:
//   local:  npm run seed
//   prod:   set -a && . ./.env.prod && set +a && npm run seed
//
// Keep the credentials in sync with the frontend "Try the demo" button.
require('dotenv').config();
const crypto = require('crypto');
const prisma = require('../src/shared/database/prisma');
const storage = require('../src/shared/storage');
const { hashPassword } = require('../src/shared/utils/password');

const DEMO_EMAIL = 'demo@smartjobsearch.app';
const DEMO_PASSWORD = 'demo1234';
const DEMO_NAME = 'Alex Demo';

const DAY = 86_400_000;
const now = Date.now();
const daysAgo = (n) => new Date(now - n * DAY);
const daysFromNow = (n) => new Date(now + n * DAY);

// Build a tiny but valid single-page PDF (correct xref offsets) so seeded
// résumé/cover-letter documents download as real, openable files.
function makePdf(lines) {
  const esc = (s) => s.replace(/[()\\]/g, '\\$&');
  const text = lines
    .map((l, i) => `BT /F1 ${i === 0 ? 18 : 12} Tf 72 ${740 - i * 22} Td (${esc(l)}) Tj ET`)
    .join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += `${String(off).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

async function wipeDemo(userId) {
  // Order matters: clear rows that only SetNull on delete, then applications
  // (which cascade interviews + the join tables), then the rest.
  await prisma.activityLog.deleteMany({ where: { userId } });
  await prisma.resumeAnalysis.deleteMany({ where: { userId } });
  await prisma.application.deleteMany({ where: { userId } });
  await prisma.document.deleteMany({ where: { userId } });
  await prisma.contact.deleteMany({ where: { userId } });
  await prisma.company.deleteMany({ where: { userId } });
}

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash, name: DEMO_NAME },
    create: { email: DEMO_EMAIL, passwordHash, name: DEMO_NAME },
  });
  const userId = user.id;
  await wipeDemo(userId);
  console.log(`Demo user ready: ${DEMO_EMAIL} (${userId})`);

  // --- Companies ---
  const companyData = [
    { name: 'Northwind Cloud', industry: 'Cloud Infrastructure', location: 'Remote (Global)', website: 'https://northwind.example.com', size: '500-1000' },
    { name: 'Helio Fintech', industry: 'Fintech', location: 'Singapore', website: 'https://helio.example.com', size: '200-500' },
    { name: 'Brightwave Analytics', industry: 'Data & Analytics', location: 'Remote (APAC)', website: 'https://brightwave.example.com', size: '50-200' },
    { name: 'Lumen Health', industry: 'HealthTech', location: 'Manila, PH', website: 'https://lumen.example.com', size: '1000+' },
    { name: 'Acme Labs', industry: 'Developer Tools', location: 'Remote', website: 'https://acme.example.com', size: '10-50' },
    { name: 'TechFlow', industry: 'SaaS', location: 'Remote (PH)', website: 'https://techflow.example.com', size: '50-200' },
  ];
  const companies = {};
  for (const c of companyData) {
    const row = await prisma.company.create({ data: { ...c, userId } });
    companies[c.name] = row;
  }

  // --- Applications across the whole pipeline ---
  const jd = (role) => `We're hiring a ${role}.\n\nResponsibilities:\n• Build and ship product features end to end\n• Collaborate with design and product\n• Write tested, maintainable code\n\nRequirements:\n• 3+ years with JavaScript/TypeScript, React, Node.js\n• Experience with PostgreSQL and REST APIs\n• Strong communication skills`;
  const appData = [
    { key: 'northwindSenior', position: 'Senior Full Stack Engineer', company: 'Northwind Cloud', status: 'Offer', salaryMin: 120000, salaryMax: 150000, appliedAgo: 34, source: 'https://www.linkedin.com/jobs/view/3912345678', notes: 'Strong process. Verbal offer received — negotiating equity.' },
    { key: 'helioBackend', position: 'Backend Engineer', company: 'Helio Fintech', status: 'Final_Interview', salaryMin: 110000, salaryMax: 140000, appliedAgo: 28, source: 'https://www.linkedin.com/jobs/view/3911112222', notes: 'Final panel scheduled. Prep system design.' },
    { key: 'brightwaveFs', position: 'Full Stack Developer', company: 'Brightwave Analytics', status: 'Technical_Interview', salaryMin: 90000, salaryMax: 120000, appliedAgo: 21, source: 'https://news.ycombinator.com/jobs', notes: 'Take-home went well. Live coding next.' },
    { key: 'lumenFrontend', position: 'Frontend Engineer (React)', company: 'Lumen Health', status: 'HR_Screening', salaryMin: 95000, salaryMax: 115000, appliedAgo: 12, source: 'https://lumen.example.com/careers', notes: 'Recruiter call done — moving to hiring manager.' },
    { key: 'acmeSwe', position: 'Software Engineer', company: 'Acme Labs', status: 'Applied', salaryMin: 100000, salaryMax: 130000, appliedAgo: 7, source: 'https://acme.example.com/jobs', notes: '' },
    { key: 'techflowNode', position: 'Node.js Engineer (Remote)', company: 'TechFlow', status: 'Applied', salaryMin: 35000, salaryMax: 45000, appliedAgo: 4, source: 'https://ph.indeed.com/viewjob?jk=4e2e6619c5279065', notes: 'PH-based, fully remote.' },
    { key: 'northwindPlatform', position: 'Platform Engineer', company: 'Northwind Cloud', status: 'Rejected', salaryMin: 130000, salaryMax: 160000, appliedAgo: 40, source: 'https://www.linkedin.com/jobs/view/3900001111', notes: 'Rejected after technical — wanted more Kubernetes depth.' },
    { key: 'brightwaveReact', position: 'React Developer', company: 'Brightwave Analytics', status: 'Accepted', salaryMin: 100000, salaryMax: 125000, appliedAgo: 60, source: 'Referral', notes: 'Accepted! Starts next month. (kept for history)' },
    { key: 'helioDevops', position: 'DevOps Engineer', company: 'Helio Fintech', status: 'Draft', salaryMin: null, salaryMax: null, appliedAgo: null, source: '', notes: 'Draft — tailor résumé before applying.' },
    { key: 'lumenStaff', position: 'Staff Engineer', company: 'Lumen Health', status: 'Withdrawn', salaryMin: 150000, salaryMax: 190000, appliedAgo: 50, source: 'https://lumen.example.com/careers', notes: 'Withdrew — relocation required.' },
  ];
  const apps = {};
  for (const a of appData) {
    const row = await prisma.application.create({
      data: {
        userId,
        companyId: companies[a.company].id,
        position: a.position,
        status: a.status,
        applicationDate: a.appliedAgo == null ? null : daysAgo(a.appliedAgo),
        salaryMin: a.salaryMin,
        salaryMax: a.salaryMax,
        source: a.source || null,
        jobDescription: a.status === 'Draft' ? null : jd(a.position),
        notes: a.notes || null,
        createdAt: a.appliedAgo == null ? daysAgo(2) : daysAgo(a.appliedAgo),
      },
    });
    apps[a.key] = row;
  }

  // --- Interviews (past results + upcoming, so Reminders has content) ---
  const interviewData = [
    { app: 'northwindSenior', type: 'HR', interviewer: 'Priya Nair', result: 'Passed', when: daysAgo(26) },
    { app: 'northwindSenior', type: 'Technical', interviewer: 'Marco Lee', result: 'Passed', when: daysAgo(18) },
    { app: 'northwindSenior', type: 'Final', interviewer: 'Dana Cole (VP Eng)', result: 'Passed', when: daysAgo(8) },
    { app: 'helioBackend', type: 'HR', interviewer: 'Sofia Reyes', result: 'Passed', when: daysAgo(20) },
    { app: 'helioBackend', type: 'Managerial', interviewer: 'Ken Tan', result: 'Pending', when: daysFromNow(3) },
    { app: 'brightwaveFs', type: 'HR', interviewer: 'Liam Cruz', result: 'Passed', when: daysAgo(10) },
    { app: 'brightwaveFs', type: 'Technical', interviewer: 'Grace Lim', result: 'Pending', when: daysFromNow(2) },
    { app: 'lumenFrontend', type: 'HR', interviewer: 'Recruiting Team', result: 'Pending', when: daysFromNow(5) },
    { app: 'northwindPlatform', type: 'Technical', interviewer: 'Sam Ortega', result: 'Failed', when: daysAgo(30) },
  ];
  for (const iv of interviewData) {
    await prisma.interview.create({
      data: {
        userId,
        applicationId: apps[iv.app].id,
        type: iv.type,
        interviewer: iv.interviewer,
        result: iv.result,
        scheduledAt: iv.when,
        createdAt: iv.when < new Date() ? iv.when : daysAgo(1),
      },
    });
  }

  // --- Contacts (some with follow-ups, for Reminders) ---
  const contactData = [
    { name: 'Priya Nair', company: 'Northwind Cloud', position: 'Senior Recruiter', email: 'priya@northwind.example.com', linkedinUrl: 'https://linkedin.com/in/priyanair', followUp: daysFromNow(2) },
    { name: 'Marco Lee', company: 'Northwind Cloud', position: 'Engineering Manager', email: 'marco@northwind.example.com', linkedinUrl: 'https://linkedin.com/in/marcolee' },
    { name: 'Sofia Reyes', company: 'Helio Fintech', position: 'Talent Partner', email: 'sofia@helio.example.com', followUp: daysAgo(1) },
    { name: 'Ken Tan', company: 'Helio Fintech', position: 'Backend Lead', email: 'ken@helio.example.com', linkedinUrl: 'https://linkedin.com/in/kentan' },
    { name: 'Grace Lim', company: 'Brightwave Analytics', position: 'Staff Engineer', email: 'grace@brightwave.example.com' },
    { name: 'Liam Cruz', company: 'Brightwave Analytics', position: 'Recruiter', email: 'liam@brightwave.example.com', followUp: daysFromNow(6) },
    { name: 'Dana Cole', company: 'Northwind Cloud', position: 'VP Engineering', email: 'dana@northwind.example.com' },
    { name: 'Jordan Park', company: 'Acme Labs', position: 'Founder', email: 'jordan@acme.example.com', linkedinUrl: 'https://linkedin.com/in/jordanpark' },
  ];
  const contacts = {};
  for (const c of contactData) {
    const row = await prisma.contact.create({
      data: {
        userId,
        companyId: companies[c.company].id,
        name: c.name,
        position: c.position,
        email: c.email || null,
        linkedinUrl: c.linkedinUrl || null,
        followUpDate: c.followUp || null,
      },
    });
    contacts[c.name] = row;
  }

  // --- Documents (real downloadable PDFs in storage) ---
  const docData = [
    { name: 'Alex Demo — Résumé', type: 'Resume', filename: 'alex-demo-resume.pdf', lines: ['Alex Demo — Senior Full Stack Engineer', 'JavaScript · TypeScript · React · Node.js · PostgreSQL', 'Experience: 6 years building and shipping web products', 'Education: BS Computer Science'] },
    { name: 'Backend-focused Résumé v2', type: 'Resume', filename: 'alex-demo-resume-backend.pdf', lines: ['Alex Demo — Backend Engineer', 'Node.js · Express · Prisma · PostgreSQL · AWS', 'Tailored for backend/platform roles'] },
    { name: 'Cover Letter — Northwind Cloud', type: 'CoverLetter', filename: 'cover-letter-northwind.pdf', lines: ['Dear Northwind Cloud Hiring Team,', 'I am excited to apply for the Senior Full Stack Engineer role...', '— Alex Demo'] },
  ];
  const docs = {};
  for (const d of docData) {
    const buffer = makePdf(d.lines);
    const storageKey = `${userId}/${crypto.randomUUID()}-${d.filename}`;
    await storage.save(buffer, storageKey);
    const row = await prisma.document.create({
      data: {
        userId,
        name: d.name,
        type: d.type,
        originalFilename: d.filename,
        mimeType: 'application/pdf',
        sizeBytes: buffer.length,
        storageKey,
      },
    });
    docs[d.name] = row;
  }

  // --- Link contacts + documents to applications ---
  const contactLinks = [
    ['northwindSenior', 'Priya Nair'], ['northwindSenior', 'Dana Cole'],
    ['helioBackend', 'Sofia Reyes'], ['helioBackend', 'Ken Tan'],
    ['brightwaveFs', 'Grace Lim'], ['brightwaveFs', 'Liam Cruz'],
    ['acmeSwe', 'Jordan Park'],
  ];
  for (const [appKey, name] of contactLinks) {
    await prisma.applicationContact.create({ data: { applicationId: apps[appKey].id, contactId: contacts[name].id } });
  }
  const docLinks = [
    ['northwindSenior', 'Alex Demo — Résumé'], ['northwindSenior', 'Cover Letter — Northwind Cloud'],
    ['helioBackend', 'Backend-focused Résumé v2'], ['brightwaveFs', 'Alex Demo — Résumé'],
  ];
  for (const [appKey, name] of docLinks) {
    await prisma.applicationDocument.create({ data: { applicationId: apps[appKey].id, documentId: docs[name].id } });
  }

  // --- Precomputed résumé analyses (no AI run needed) ---
  const entry = (term, type, jdCount, resumeCount, weight) => ({ term, type, jdCount, resumeCount, weight });
  await prisma.resumeAnalysis.create({
    data: {
      userId,
      applicationId: apps.northwindSenior.id,
      documentId: docs['Alex Demo — Résumé'].id,
      atsScore: 88,
      matchScore: 82,
      report: {
        meta: { documentName: 'Alex Demo — Résumé', position: 'Senior Full Stack Engineer', jdPresent: true, extractionOk: true, wordCount: 612, aiUsed: false, aiModel: null },
        atsSubScores: { parseability: 95, sections: 90, contactInfo: 100, formatting: 80, length: 75 },
        matched: [entry('react', 'hard', 4, 6, 0.9), entry('node.js', 'hard', 3, 5, 0.9), entry('postgresql', 'hard', 2, 3, 0.8), entry('typescript', 'hard', 3, 4, 0.85), entry('communication', 'soft', 1, 2, 0.4)],
        missing: [entry('graphql', 'hard', 2, 0, 0.7), entry('kubernetes', 'hard', 1, 0, 0.6)],
        sectionFindings: [{ section: 'Contact', present: true }, { section: 'Experience', present: true }, { section: 'Education', present: true }, { section: 'Skills', present: true }, { section: 'Summary', present: false }],
        suggestions: [
          { text: 'Add a short professional summary at the top to anchor your pitch.', severity: 'medium', source: 'rule' },
          { text: 'Mention GraphQL — it appears twice in the job description but not in your résumé.', severity: 'high', source: 'rule' },
          { text: 'Quantify impact (e.g. "cut API latency 40%") in your experience bullets.', severity: 'low', source: 'rule' },
        ],
      },
    },
  });
  await prisma.resumeAnalysis.create({
    data: {
      userId,
      applicationId: apps.brightwaveFs.id,
      documentId: docs['Alex Demo — Résumé'].id,
      atsScore: 73,
      matchScore: 68,
      report: {
        meta: { documentName: 'Alex Demo — Résumé', position: 'Full Stack Developer', jdPresent: true, extractionOk: true, wordCount: 612, aiUsed: false, aiModel: null },
        atsSubScores: { parseability: 95, sections: 80, contactInfo: 100, formatting: 70, length: 60 },
        matched: [entry('react', 'hard', 3, 6, 0.9), entry('javascript', 'hard', 5, 7, 0.85)],
        missing: [entry('python', 'hard', 3, 0, 0.8), entry('etl', 'hard', 2, 0, 0.6), entry('tableau', 'hard', 1, 0, 0.5)],
        sectionFindings: [{ section: 'Contact', present: true }, { section: 'Experience', present: true }, { section: 'Skills', present: true }, { section: 'Summary', present: false }],
        suggestions: [
          { text: 'This analytics role leans on Python/ETL — consider a tailored résumé version.', severity: 'high', source: 'rule' },
          { text: 'Trim to one page; current length slightly hurts the ATS length score.', severity: 'low', source: 'rule' },
        ],
      },
    },
  });

  // --- Activity log (recent, varied — powers the Activity feed) ---
  const acts = [
    { action: 'ApplicationCreated', app: 'northwindSenior', metadata: { position: 'Senior Full Stack Engineer' }, at: daysAgo(34) },
    { action: 'InterviewScheduled', app: 'northwindSenior', metadata: { position: 'Senior Full Stack Engineer', type: 'HR' }, at: daysAgo(28) },
    { action: 'InterviewResultRecorded', app: 'northwindSenior', metadata: { position: 'Senior Full Stack Engineer', type: 'Final', result: 'Passed' }, at: daysAgo(8) },
    { action: 'ApplicationStatusChanged', app: 'northwindSenior', metadata: { position: 'Senior Full Stack Engineer', from: 'Final_Interview', to: 'Offer' }, at: daysAgo(7) },
    { action: 'ApplicationCreated', app: 'helioBackend', metadata: { position: 'Backend Engineer' }, at: daysAgo(28) },
    { action: 'ContactLinked', app: 'helioBackend', metadata: { position: 'Backend Engineer', name: 'Sofia Reyes' }, at: daysAgo(27) },
    { action: 'ApplicationStatusChanged', app: 'helioBackend', metadata: { position: 'Backend Engineer', from: 'Technical_Interview', to: 'Final_Interview' }, at: daysAgo(6) },
    { action: 'DocumentLinked', app: 'brightwaveFs', metadata: { position: 'Full Stack Developer', name: 'Alex Demo — Résumé' }, at: daysAgo(19) },
    { action: 'ApplicationStatusChanged', app: 'brightwaveFs', metadata: { position: 'Full Stack Developer', from: 'Applied', to: 'Technical_Interview' }, at: daysAgo(11) },
    { action: 'ApplicationCreated', app: 'lumenFrontend', metadata: { position: 'Frontend Engineer (React)' }, at: daysAgo(12) },
    { action: 'ApplicationCreated', app: 'acmeSwe', metadata: { position: 'Software Engineer' }, at: daysAgo(7) },
    { action: 'ApplicationCreated', app: 'techflowNode', metadata: { position: 'Node.js Engineer (Remote)' }, at: daysAgo(4) },
  ];
  for (const a of acts) {
    await prisma.activityLog.create({
      data: { userId, action: a.action, applicationId: apps[a.app]?.id ?? null, metadata: a.metadata, createdAt: a.at },
    });
  }

  console.log(`Seeded: ${companyData.length} companies, ${appData.length} applications, ${interviewData.length} interviews, ${contactData.length} contacts, ${docData.length} documents, 2 analyses, ${acts.length} activity events.`);
}

main()
  .then(async () => { await prisma.$disconnect(); console.log('Demo seed complete ✅'); })
  .catch(async (e) => { console.error('Seed failed:', e); await prisma.$disconnect(); process.exit(1); });
