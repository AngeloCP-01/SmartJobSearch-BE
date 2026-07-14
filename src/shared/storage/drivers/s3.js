// S3-compatible object-storage driver — used in production so uploads survive
// redeploys on hosts with ephemeral disks (Render free tier, etc.).
//
// Works with any S3-compatible API by setting S3_ENDPOINT:
//   - Supabase Storage: https://<project-ref>.storage.supabase.co/storage/v1/s3
//   - Cloudflare R2:     https://<account-id>.r2.cloudflarestorage.com
//   - AWS S3:            leave S3_ENDPOINT unset (uses the region default)
//
// Most non-AWS providers require path-style addressing (default on here).
const { PassThrough } = require('stream');
const {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand,
} = require('@aws-sdk/client-s3');

const bucket = process.env.S3_BUCKET;
const client = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

async function save(buffer, key) {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer }));
}

// Return a stream synchronously to match the local driver's contract: callers
// attach 'open' (download headers), 'error', 'data'/'end' listeners and pipe.
// GetObject is async, so we hand back a PassThrough now and feed it once the
// object resolves — emitting 'open' first (parity with fs.createReadStream),
// and surfacing a missing object / network failure as an 'error'.
function createReadStream(key) {
  const out = new PassThrough();
  client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    .then(({ Body }) => {
      out.emit('open');
      Body.on('error', (err) => out.destroy(err));
      Body.pipe(out);
    })
    .catch((err) => out.destroy(err));
  return out;
}

async function remove(key) {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// Health probe: a HeadBucket confirms credentials + the bucket are reachable
// without transferring any object. Rejects (surfaced as an unhealthy check) on
// any auth/network/paused-store failure.
async function ping() {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  return true;
}

module.exports = { save, createReadStream, remove, ping };
