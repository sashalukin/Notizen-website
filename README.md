# Notizen

A note-taking web app built with Next.js, designed to be embedded in an Android app via WebView (this is an educational project). Google OAuth handles ordinary browser sign-in; notes support rich text and attachments. This example baseline intentionally has no Android session handoff.

## Stack

- **Framework:** Next.js 16 (App Router), React 19
- **Auth:** NextAuth v5 (beta) with Google provider, custom Postgres adapter (`src/lib/auth.js`)
- **Database:** Postgres (raw `pg` queries, no ORM) — schema in `setup.sql`
- **Storage:** Google Cloud Storage for uploaded images (`@google-cloud/storage`)
- **Deployment:** Google Cloud Run via `gcloud` (Dockerfile included) — **not** Vercel

## Project layout

```
src/app/
  page.js                       Landing page
  signin/                       Web sign-in page
  notes/                        Main authenticated app (list + note editor), protected by middleware.js
  api/
    auth/[...nextauth]/         NextAuth handlers
    notes/                      CRUD for notes
    upload/                     Image upload to GCS
src/components/                 NoteEditor, Sidebar, UserMenu
src/lib/
  auth.js                       NextAuth config + hand-rolled Postgres adapter
  db.js                         pg Pool
src/middleware.js               Route protection for /notes
setup.sql                       Full DB schema (users, accounts, sessions, notes, ...)
public/.well-known/assetlinks.json   Digital Asset Links file for Android App Links / Custom Tabs trust
Dockerfile                      Multi-stage build for Cloud Run (standalone Next.js output)
```

## Environment variables

See `.env.example`. Required:

- `DATABASE_URL` — Postgres connection string
- `AUTH_SECRET` — NextAuth JWT secret (`npx auth secret`)
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — Google OAuth client credentials
- `NEXTAUTH_URL` — base URL of the deployment

Google Cloud Storage credentials are picked up via Application Default Credentials (not in `.env`) when running on Cloud Run; for local dev you'd need a service account key or `gcloud auth application-default login`.

## Local dev

```
npm install
npm run dev
```

Apply `setup.sql` to a local/dev Postgres database before running. `.env` is gitignored — copy `.env.example` and fill in real values.

## Deployment

Deploys to **Google Cloud Run**, not Vercel — build via the included `Dockerfile` and deploy with `gcloud run deploy`. There is no CI/CD pipeline in this repo yet; deploys are manual.

