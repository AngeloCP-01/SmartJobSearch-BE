// Content for the public demo account (used by prisma/seed.js).
//
// The AI features are grounded: a cover letter or tailoring suggestion may only
// use facts that are in the résumé, and it is matched against the job
// description. So the quality of every AI demo depends on this content being
// realistic: a full résumé with concrete work, and a distinct job description
// per application. All people and companies here are fictional.
//
// Résumé/letter lines are rendered into PDFs by makePdf in seed.js. A line is
// a string (body text) or { t, h } where h is 'name' | 'section' | 'role'.
// Keep body lines under ~95 characters: PDF text does not wrap. Stick to
// Latin-1 characters (no em dashes): the PDF uses WinAnsiEncoding.

const RESUME_FULL_STACK = [
  { t: 'Alex Demo', h: 'name' },
  'Senior Full Stack Engineer | Remote (Manila, PH) | alex.demo@example.com | github.com/alexdemo',
  { t: 'Summary', h: 'section' },
  'Full stack engineer with 6 years of experience building React and Node.js products. Most recently',
  'led the frontend of a B2B scheduling platform used by 1,200 clinics and built its billing and',
  'reporting APIs. Comfortable owning features from database schema to UI, with a focus on',
  'performance, accessibility and automated testing.',
  { t: 'Experience', h: 'section' },
  { t: 'Senior Full Stack Engineer, Clinicora (healthcare scheduling SaaS) | 2023 - present', h: 'role' },
  '- Led a 4-person team rebuilding the booking web app in React 18 and TypeScript; cut LCP',
  '  from 4.1s to 1.6s by code-splitting routes and moving heavy reports to server-side pagination.',
  '- Built a shared component library (40+ components, Storybook, WCAG 2.1 AA) used by 3 teams.',
  '- Designed REST APIs in Node.js, Express and PostgreSQL for billing, invoicing and usage reports.',
  '- Added Playwright end-to-end tests to CI; production regressions dropped by about 60%.',
  '- Mentored 2 mid-level engineers through code reviews and weekly pairing sessions.',
  { t: 'Full Stack Engineer, Cartwell (e-commerce platform) | 2020 - 2023', h: 'role' },
  '- Built catalog, cart and checkout features in React, Redux and Node.js for 300k monthly shoppers.',
  '- Migrated the order service from MongoDB to PostgreSQL with Prisma using dual writes, with no',
  '  downtime during the cutover.',
  '- Added Redis caching to search endpoints, lowering p95 latency from 900ms to 220ms.',
  '- Wrote unit and integration tests with Jest and React Testing Library (85% coverage on core',
  '  services) and introduced pull-request checks for lint, types and tests.',
  { t: 'Software Engineer, Pixelyard Studio (web agency) | 2019 - 2020', h: 'role' },
  '- Shipped 8 client web apps with React, Node.js and REST APIs, from scoping to production.',
  '- Set up GitHub Actions CI/CD and Docker deployments to AWS (ECS, RDS, S3) for agency clients.',
  { t: 'Skills', h: 'section' },
  'Languages: TypeScript, JavaScript, SQL, HTML, CSS',
  'Frontend: React, Next.js, Redux, Tailwind CSS, Storybook, Vite, accessibility (WCAG)',
  'Backend: Node.js, Express, Prisma, PostgreSQL, Redis, REST; familiar with GraphQL',
  'Testing and DevOps: Jest, React Testing Library, Playwright, Docker, GitHub Actions, AWS',
  { t: 'Education', h: 'section' },
  'BS Computer Science, 2019',
];

const RESUME_BACKEND = [
  { t: 'Alex Demo', h: 'name' },
  'Backend Engineer | Remote (Manila, PH) | alex.demo@example.com | github.com/alexdemo',
  { t: 'Summary', h: 'section' },
  'Backend-leaning engineer with 6 years of experience, the last 5 building Node.js services and',
  'PostgreSQL data models for SaaS and e-commerce products, including billing and order systems.',
  { t: 'Experience', h: 'section' },
  { t: 'Senior Full Stack Engineer, Clinicora (healthcare scheduling SaaS) | 2023 - present', h: 'role' },
  '- Designed REST APIs in Node.js, Express and PostgreSQL for billing, invoicing and usage reports.',
  '- Moved monthly invoice generation to a background job queue, removing request timeouts for',
  '  clinics with 50k+ appointments.',
  '- Added structured logging and error alerts, cutting time to diagnose billing incidents.',
  { t: 'Full Stack Engineer, Cartwell (e-commerce platform) | 2020 - 2023', h: 'role' },
  '- Migrated the order service from MongoDB to PostgreSQL with Prisma using dual writes, with no',
  '  downtime during the cutover.',
  '- Added Redis caching to search endpoints, lowering p95 latency from 900ms to 220ms.',
  '- Built the payment webhook handler with idempotency keys so retried events never double-charged.',
  { t: 'Software Engineer, Pixelyard Studio (web agency) | 2019 - 2020', h: 'role' },
  '- Set up GitHub Actions CI/CD and Docker deployments to AWS (ECS, RDS, S3) for agency clients.',
  { t: 'Skills', h: 'section' },
  'Node.js, Express, Prisma, PostgreSQL, Redis, REST, Docker, GitHub Actions, AWS (ECS, RDS, S3)',
  'Testing: Jest, Supertest | Familiar with: GraphQL, Kafka',
  { t: 'Education', h: 'section' },
  'BS Computer Science, 2019',
];

const SAMPLE_COVER_LETTER = [
  { t: 'Alex Demo', h: 'name' },
  'alex.demo@example.com',
  '',
  'Dear Northwind Cloud hiring team,',
  '',
  'For the last three years I have led the frontend of a scheduling platform used by 1,200 clinics,',
  'while also building the Node.js and PostgreSQL APIs behind its billing and reports. That mix of',
  'owning the React app and the services it depends on is what your Senior Full Stack role asks for.',
  '',
  'At Clinicora I rebuilt the booking app in React and TypeScript and cut its load time from 4.1s',
  'to 1.6s. Before that, at Cartwell, I migrated the order service from MongoDB to PostgreSQL',
  'without downtime and added Redis caching that brought search latency down from 900ms to 220ms.',
  '',
  'Happy to talk through any of this in more detail.',
  '',
  'Alex Demo',
];

// One realistic job description per seeded application (keyed like appData in seed.js).
const JOB_DESCRIPTIONS = {
  northwindSenior: `Northwind Cloud runs managed infrastructure for 3,000 engineering teams. We're hiring a Senior Full Stack Engineer for the console team, which owns the web app customers use to provision and monitor their services.

What you'll do
• Build features across our React + TypeScript console and the Node.js APIs behind it
• Own performance of data-heavy pages (usage graphs, logs, billing)
• Design PostgreSQL schemas and REST endpoints with the platform team
• Review code and mentor engineers on the team

What we're looking for
• 5+ years of professional full stack experience with React and Node.js
• Strong TypeScript and SQL (PostgreSQL preferred)
• A track record of measurable frontend performance work
• Experience with automated testing and CI

Nice to have: usage-based billing, Redis, AWS`,

  helioBackend: `Helio Fintech processes cross-border payments for 40,000 small businesses in Southeast Asia. Our backend team builds the services that move money, so correctness matters more than speed.

Responsibilities
• Design and build Node.js services for payments, ledgers and payouts
• Model financial data in PostgreSQL with strong consistency guarantees
• Make payment flows idempotent and safe to retry
• Improve observability: logging, metrics and alerting
• Take part in a light on-call rotation

Requirements
• 4+ years building backend services with Node.js (TypeScript a plus)
• Deep PostgreSQL experience: schema design, transactions, query tuning
• Experience with payment providers, webhooks or financial systems
• Familiarity with queues or background job processing

Nice to have: Kafka, Redis, AWS`,

  brightwaveFs: `Brightwave Analytics gives retail brands dashboards over their sales and inventory data. We're a team of 60 and looking for a Full Stack Developer to work on our customer-facing analytics app.

You will
• Build dashboard features in React, from charts to filters to exports
• Write Node.js APIs that aggregate large datasets efficiently
• Work with our data team on SQL queries and caching strategies
• Ship small, well-tested changes several times a week

You have
• 3+ years with React and Node.js
• Solid SQL skills and experience optimizing slow queries
• Experience with caching (Redis or similar)
• Good testing habits (Jest, React Testing Library or similar)

Bonus: charting libraries, e-commerce data, PostgreSQL`,

  lumenFrontend: `Lumen Health builds the patient portal used by 60 hospitals across the Philippines. Patients use it to book appointments, see results and message their doctors, so accessibility and reliability are non-negotiable.

The role
• Build patient-facing features in React and TypeScript
• Maintain and extend our component library and design system
• Make every flow accessible (WCAG 2.1 AA) and fast on low-end Android phones
• Write end-to-end tests for critical journeys like booking and payments
• Work closely with designers and backend engineers

What you bring
• 4+ years of professional frontend experience with React
• Strong TypeScript, HTML and CSS fundamentals
• Hands-on accessibility experience
• Experience with Playwright or Cypress

Nice to have: healthcare or scheduling products, Storybook, Next.js`,

  acmeSwe: `Acme Labs makes developer tools: a CLI and web dashboard that help teams manage feature flags across environments. We're 12 people, fully remote, and every engineer works across the stack.

What you'll work on
• Features in our React dashboard and the Node.js + PostgreSQL API behind it
• Our public REST API and its documentation, used by 900 customer teams
• Reliability work: tests, CI and safe database migrations
• Talking directly with customers to understand what to build next

About you
• 3+ years building web products with TypeScript, React and Node.js
• Comfortable designing REST APIs and PostgreSQL schemas
• You care about tests and have set up CI pipelines
• You like small teams and owning features end to end

Bonus: experience at a startup or agency, Docker, GitHub Actions`,

  techflowNode: `TechFlow is a PH-based SaaS company building workflow automation for HR teams. We're hiring a Node.js Engineer to join our remote backend squad.

Responsibilities
• Build and maintain Node.js/Express services and REST APIs
• Integrate third-party HR and payroll systems via webhooks
• Write background jobs for reports and scheduled syncs
• Write unit and integration tests

Requirements
• 3+ years of Node.js experience
• Experience with MongoDB or PostgreSQL
• Experience with Docker and CI/CD
• Good written English for async, remote collaboration`,

  northwindPlatform: `Northwind Cloud's platform team runs the Kubernetes clusters behind our managed services. We're looking for a Platform Engineer.

You will
• Operate and scale multi-region Kubernetes clusters
• Manage infrastructure as code with Terraform
• Build internal tooling for deployments and incident response

You have
• 4+ years in platform, SRE or DevOps roles
• Production Kubernetes and Terraform experience
• Strong Linux and networking fundamentals`,

  brightwaveReact: `Brightwave Analytics is hiring a React Developer to build new dashboard views and improve our design system.

You will
• Build data-heavy React views with charts and tables
• Improve performance and accessibility across the app
• Contribute to our Storybook component library

You have
• 3+ years of React and TypeScript
• Experience with component libraries and Storybook
• An eye for UI detail`,

  lumenStaff: `Lumen Health is hiring a Staff Engineer to set technical direction across our patient portal and clinical integrations. This role is on-site in Manila.

You will
• Lead architecture decisions across 5 product teams
• Drive reliability and security standards for healthcare data
• Mentor senior engineers and run design reviews

You have
• 8+ years of software engineering experience
• Experience leading large-scale system design
• Healthcare or regulated-industry experience preferred`,
};

module.exports = { RESUME_FULL_STACK, RESUME_BACKEND, SAMPLE_COVER_LETTER, JOB_DESCRIPTIONS };
