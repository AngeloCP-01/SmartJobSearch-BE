#!/bin/sh
# Boot the API. Migrations are attempted first, but a migration failure must NOT
# stop the server from starting.
#
# Why this exists: the start command used to be
#   npx prisma migrate deploy && node src/server.js
# On 2026-08-20 Neon (free tier, scale-to-zero) suspended on quota, `migrate
# deploy` could not connect and exited non-zero, the `&&` short-circuited, and
# `node` never ran. Render then served 503 "no healthy upstream" for 11 days --
# a failed deploy is not retried, and it does not notice when the database comes
# back. Even /api/health, which touches no database, was unreachable, because the
# process never existed to serve it.
#
# Trade-off, deliberately accepted: a genuinely broken migration now boots a
# server against a stale schema, surfacing as runtime errors on the affected
# routes instead of a failed deploy. Partial availability beats total darkness,
# and the warning below is the signal to grep for in Render logs.

set -u

if npx prisma migrate deploy; then
  echo "[start] migrations applied cleanly"
else
  status=$?
  echo "[start] WARNING: 'prisma migrate deploy' failed (exit ${status}) -- starting the server anyway."
  echo "[start] WARNING: the database may be unreachable, or the schema may be stale."
fi

# exec so node replaces this shell as PID 1 and receives Render's SIGTERM
# directly, which keeps graceful shutdown working.
exec node src/server.js
