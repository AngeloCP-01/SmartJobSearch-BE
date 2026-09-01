/**
 * Guards the deploy boot contract.
 *
 * Regression this exists to prevent: render.yaml used to start the API with
 *   `npx prisma migrate deploy && node src/server.js`
 * On 2026-08-20 Neon (free tier, scale-to-zero) suspended, migrate exited
 * non-zero, the `&&` short-circuited, and node never ran. The whole API went
 * dark for 11 days -- including /api/health, which touches no database --
 * because Render does not retry a failed deploy.
 *
 * The boot must therefore survive a failing migration.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const START_SCRIPT = path.join(repoRoot, 'scripts', 'start.sh');
const SERVER_STARTED = 'FAKE_SERVER_STARTED';

/** Build a PATH shim dir where `npx` exits with `npxExit` and `node` marks that it ran. */
function shimDir(npxExit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startsh-'));
  fs.writeFileSync(path.join(dir, 'npx'), `#!/bin/sh\nexit ${npxExit}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'node'), `#!/bin/sh\necho ${SERVER_STARTED} "$@"\n`, { mode: 0o755 });
  return dir;
}

function runStart(npxExit) {
  const dir = shimDir(npxExit);
  try {
    return spawnSync('sh', [START_SCRIPT], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the server still boots when prisma migrate deploy fails', () => {
  const res = runStart(1);
  const out = `${res.stdout}${res.stderr}`;
  expect(out).toContain(SERVER_STARTED);
  expect(out).toMatch(/src\/server\.js/);
  expect(res.status).toBe(0);
});

test('a failed migration is reported loudly rather than swallowed', () => {
  const out = `${runStart(1).stdout}${runStart(1).stderr}`;
  expect(out).toMatch(/WARN/i);
});

test('the server boots on the happy path too', () => {
  const res = runStart(0);
  expect(`${res.stdout}${res.stderr}`).toContain(SERVER_STARTED);
  expect(res.status).toBe(0);
});

test('render.yaml does not chain the server boot behind migrations', () => {
  const render = fs.readFileSync(path.join(repoRoot, 'render.yaml'), 'utf8');
  const startCommand = render.match(/^\s*startCommand:\s*(.+)$/m);
  expect(startCommand).not.toBeNull();
  // `migrate deploy && node` is the exact shape that caused the outage.
  expect(startCommand[1]).not.toMatch(/migrate\s+deploy\s*&&/);
});
