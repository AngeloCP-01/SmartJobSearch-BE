# Deploying JobTrail (free tier)

> **Live since 2026-06-25.** Rebranded to **JobTrail** and moved the frontend to `jobtrail-hq.vercel.app` on 2026-06-29 (old `smart-job-search-fe.vercel.app` kept as a redirect).
> - Frontend: `https://jobtrail-hq.vercel.app` (Vercel)
> - API: `https://smartjobsearch-api.onrender.com/api` (Render free) — health: `/api/health`
> - DB: Neon Postgres · Uploads: Supabase Storage bucket `job_search_documents`
>
> **Gotchas that bit us (don't repeat):**
> 1. **`CORS_ORIGIN` must exactly equal the browser's `Origin`** — `https://jobtrail-hq.vercel.app`, scheme + host only. The server returns this one fixed string as `Access-Control-Allow-Origin`, so any mismatch silently CORS-blocks every request (registration just fails). Two ways we got bitten: (a) a trailing path (`…/login`) — a browser's `Origin` has no path; (b) a typo'd single slash (`https:/…`) — it must be `https://` with two. Renaming the Vercel *project* does **not** change the `.vercel.app` URL — only adding a domain under Settings → Domains does.
> 2. **`NODE_ENV` must be lowercase `production`** — the code checks `=== 'production'`. `"PRODUCTION"` leaves the cookie at `SameSite=Lax` (not sent cross-site) and `trust proxy` off.


A $0/month full-stack deploy. Four services, all on free plans:

| Piece | Service | Why |
|-------|---------|-----|
| Frontend (Vite SPA) | **Vercel** | Best free static/SPA host |
| Backend (Express API) | **Render** (free web service) | Free Node host; ⚠️ cold-starts after ~15 min idle |
| Database (Postgres) | **Neon** | Free managed Postgres that **does not expire** |
| File uploads | **Supabase Storage** (S3-compatible) | Free 1 GB, no credit card; survives Render redeploys |

```
Browser ──▶ Vercel (FE)  ──VITE_API_URL──▶  Render (API)  ──▶  Neon (Postgres)
                                                 └──S3 driver──▶  Supabase Storage
   cookies: SameSite=None; Secure        CORS_ORIGIN = the Vercel origin
```

> **Why not one host?** The API needs a persistent DB, persistent file storage, and a long-running process for AI calls. Free tiers don't bundle all three, so we split them. To collapse this into one paid service (~$5/mo, no cold starts, local volume for uploads), use Railway instead and set `STORAGE_DRIVER=local` with a mounted volume — see the note at the end.

**Heads-up on the free tier:** Render free spins the API down after ~15 min idle; the next request takes ~30–60 s to wake. Fine for personal use.

Both repos must be on GitHub (they are: `AngeloCP-01/SmartJobSearch-FE` and `-BE`).

---

## 1. Database — Neon (Postgres)

1. Sign up at **neon.tech** (GitHub login, no card).
2. Create a project (pick a region near you). It creates a database automatically.
3. Copy the **pooled** connection string — it looks like:
   `postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require`
4. Keep it for `DATABASE_URL` in step 3. (Migrations run automatically on deploy via `prisma migrate deploy`.)

---

## 2. File storage — Supabase Storage (S3-compatible)

1. Sign up at **supabase.com** (no card) and create a project. Set a DB password (we won't use Supabase's Postgres — only its Storage).
2. **Storage → Create bucket** → name it `documents`. Keep it **Private** (the API streams files itself; no public access needed).
3. **Project Settings → Storage → S3 Connection** (or **Settings → Storage**):
   - Note the **S3 endpoint**: `https://<project-ref>.storage.supabase.co/storage/v1/s3`
   - Note the **region** (e.g. `us-east-1` / your project's region).
   - Click **New access key** → copy the **Access key ID** and **Secret access key**.
4. Keep these for the `S3_*` vars in step 3.

> Prefer **Cloudflare R2** (10 GB free, needs a card on file)? Same driver — set
> `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`,
> and R2 token keys. No code change.

---

## 3. Backend — Render

The repo includes **`render.yaml`** (a Blueprint), so the service + env keys are pre-declared.

1. Sign up at **render.com** (GitHub login).
2. **New → Blueprint** → connect the `SmartJobSearch-BE` repo → Render reads `render.yaml`.
3. Render will prompt for the env vars marked `sync: false`. Fill in:
   - `DATABASE_URL` → the Neon pooled string from step 1.
   - `CORS_ORIGIN` → your Vercel URL from step 4 (you can put a placeholder now and fix it after step 4 — e.g. `https://smartjobsearch.vercel.app`). **No trailing slash.**
   - `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` (`documents`), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` → from step 2.
   - `PUBLIC_API_URL` → **required for editor images.** The API's own public base incl. `/api`, e.g. `https://smartjobsearch-api.onrender.com/api`. Used to build absolute `<img>` URLs for in-editor images. If unset it falls back to the request host header (works locally, but set it explicitly in prod so image URLs are stable and not derived from a client-controlled `Host`).
   - **AI + RAG (needed for ATS "Use AI", cover letters, Tailor Résumé, and Draft-in-Editor).** Leave all AI vars blank to keep résumé analysis deterministic (those features degrade gracefully). To enable them:
     - `OPENROUTER_API_KEY` → your OpenRouter key. **This gates the AI features on/off** — the Tailor and cover-letter endpoints 503 without it, even though calls route to NVIDIA.
     - `NVIDIA_OPENAI_KEY` → your NVIDIA NIM key (build.nvidia.com). **Required** — the model chain and RAG embeddings both route to NVIDIA. Without it, Tailor Résumé / Draft-in-Editor and document indexing do not work (`embeddingConfigured()` === `Boolean(NVIDIA_OPENAI_KEY)`).
     - `OPENROUTER_MODEL` → already declared in `render.yaml` as the stabilized all-NVIDIA chain (`nvidia:openai/gpt-oss-120b,nvidia:meta/llama-3.1-70b-instruct,nvidia:meta/llama-3.1-8b-instruct`); `EMBEDDING_MODEL` and `NVIDIA_BASE_URL` likewise have blueprint defaults. No dashboard action needed unless overriding.
     - After the first deploy with these keys set, **backfill RAG once** so existing documents become searchable (the index-on-upload hook only covers new uploads): authenticate and `POST /api/rag/reindex`.
   - `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` → leave to **auto-generate** (declared `generateValue: true`).
   - `STORAGE_DRIVER` is already `s3`; `NODE_ENV` is already `production`.
4. Deploy. Build runs `npm install && prisma generate`; start runs `prisma migrate deploy && node src/server.js`.
5. When live, copy the API URL: `https://smartjobsearch-api.onrender.com`. Your API base is that **+ `/api`**.
6. Verify: open `https://smartjobsearch-api.onrender.com/api/health` → `{"status":"ok"}`.

---

## 4. Frontend — Vercel

The repo includes **`vercel.json`** (framework `vite`, SPA rewrite so deep links/refresh work).

1. Sign up at **vercel.com** (GitHub login).
2. **Add New → Project** → import `SmartJobSearch-FE`. Vercel auto-detects Vite.
3. **Environment Variables** → add:
   - `VITE_API_URL` = your Render API base **including `/api`**, e.g.
     `https://smartjobsearch-api.onrender.com/api`
4. Deploy. Copy the production URL, e.g. `https://smartjobsearch.vercel.app`.

---

## 5. Wire the two origins together

1. Back in **Render → your service → Environment**, set `CORS_ORIGIN` to the exact Vercel URL from step 4 (no trailing slash) and save → it redeploys.
2. If you changed `VITE_API_URL` after the first Vercel build, **redeploy** the Vercel project so the new value is baked into the build (Vite env vars are build-time).

---

## 6. Smoke test

Open the Vercel URL and confirm:

- [ ] **Register / Login** works (sets the session).
- [ ] Refresh the page on a deep route (e.g. `/applications`) → no 404 (SPA rewrite).
- [ ] Leave the tab a minute, do an action → it still works after the access token silently **refreshes** (proves the cross-site `SameSite=None` cookie is sent).
- [ ] **Upload** a résumé in Documents, then **download** it → bytes come back (proves Supabase Storage).
- [ ] Trigger a **redeploy** on Render, then download the same file again → still works (proves uploads aren't on ephemeral disk).
- [ ] Run a **résumé analysis** → report renders.
- [ ] (If AI enabled) Toggle **Use AI** on an analysis, generate a **cover letter**, and run **Tailor Résumé** → suggestions render (proves `OPENROUTER_API_KEY` + `NVIDIA_OPENAI_KEY` + the model chain). Then **Draft in Editor** → the résumé opens and clicking a suggestion highlights it (proves RAG anchors + the editor flow).

---

## Gotchas

- **Cold start:** first request after idle is slow on Render free. Expected.
- **Neon free limits:** generous for a personal app; no expiry. If the project is paused for very long inactivity, the first query wakes it.
- **CORS errors / login "works" but you get logged out:** almost always `CORS_ORIGIN` not matching the Vercel origin exactly, or `NODE_ENV` not `production` (so the cookie stays `SameSite=Lax` and isn't sent cross-site). Both are handled when the env is set correctly.
- **Vite env is build-time:** changing `VITE_API_URL` requires a redeploy, not just a restart.
- **Migrations:** handled automatically by `prisma migrate deploy` in the start command. New migrations ship on the next deploy.

## Alternative: one paid host (~$5/mo, no cold start)

Use **Railway** for the API + its Postgres add-on + a mounted **volume** for uploads.
Set `STORAGE_DRIVER=local` and `UPLOAD_DIR=/data/uploads` (the volume mount), point
`DATABASE_URL` at the Railway Postgres, and skip Neon + Supabase entirely. Everything
else (cookies, CORS, Vercel frontend) is identical.
