// Returns a copy of a Postgres connection URL with its `schema` query param
// set to `schema`. Used to isolate each Jest worker in its own schema so the
// suite is safe to run in parallel (see globalSetup.js / loadEnv.js).
function schemaUrl(url, schema) {
  const u = new URL(url);
  u.searchParams.set('schema', schema);
  return u.toString();
}

// The Postgres schema a given Jest worker uses. Jest assigns JEST_WORKER_ID
// 1..maxWorkers (and '1' under --runInBand), so these names are stable per run.
function workerSchema(workerId = process.env.JEST_WORKER_ID || '1') {
  return `test_w${workerId}`;
}

module.exports = { schemaUrl, workerSchema };
