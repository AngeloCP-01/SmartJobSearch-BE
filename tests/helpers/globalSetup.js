const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const execFileAsync = promisify(execFile);
const { schemaUrl, workerSchema } = require('./dbUrl');

// Provision one clean, migrated Postgres schema per Jest worker so the suite
// can run in parallel: each worker (keyed by JEST_WORKER_ID) only ever touches
// its own schema, so the per-test `resetDb()` truncations never collide.
module.exports = async (globalConfig) => {
  require('dotenv').config({ path: '.env.test' });
  const baseUrl = process.env.DATABASE_URL;

  // Jest assigns worker IDs 1..maxWorkers; provision exactly that many schemas.
  const workers = Math.max(1, globalConfig.maxWorkers || os.cpus().length || 1);
  const schemas = Array.from({ length: workers }, (_, i) => workerSchema(String(i + 1)));

  // Drop + recreate each schema from a single admin connection so every run
  // starts clean (no migration drift). Schemas are database-wide, so a client
  // on the default schema can manage them all.
  const { PrismaClient } = require('@prisma/client');
  const admin = new PrismaClient({ datasources: { db: { url: baseUrl } } });
  try {
    for (const s of schemas) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${s}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  // Apply migrations into each schema (in parallel — independent targets).
  await Promise.all(
    schemas.map((s) =>
      execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: schemaUrl(baseUrl, s) },
      })
    )
  );
};
