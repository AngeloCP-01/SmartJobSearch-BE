// CORS_ORIGIN → the `origin` option for the cors middleware.
// A comma-separated list lets two frontend origins work at once, so a domain
// move (old origin redirecting to the new one) never CORS-blocks the live app.
// Unset → `true` (reflect any origin), which is only meant for local dev.
function parseCorsOrigin(value) {
  const origins = (value || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (origins.length === 0) return true;
  return origins.length === 1 ? origins[0] : origins;
}

module.exports = { parseCorsOrigin };
