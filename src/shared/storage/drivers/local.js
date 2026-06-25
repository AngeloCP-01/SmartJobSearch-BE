// Local-disk storage driver — the default for development and tests.
// Files live under UPLOAD_DIR (defaults to ./uploads relative to cwd).
const fs = require('fs');
const path = require('path');

const baseDir = () => process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const full = (key) => path.join(baseDir(), key);

async function save(buffer, key) {
  const target = full(key);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, buffer);
}

function createReadStream(key) {
  return fs.createReadStream(full(key));
}

async function remove(key) {
  await fs.promises.rm(full(key), { force: true });
}

module.exports = { save, createReadStream, remove };
