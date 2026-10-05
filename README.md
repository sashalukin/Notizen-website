# Notizen

A note-taking web app built with Next.js, designed to be embedded in an Android app via WebView (this is an educational project). Google OAuth handles sign-in on both the web and the Android WebView, notes support rich text + image uploads, and there's a custom PKCE-based auth bridge so the native Android app can pick up a web session.

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
  android-signin/               Entry point for the Android WebView OAuth bridge (see docs/oauth-flow.md)
  auth/callback/                Client-side callback page for the Android flow
  notes/                        Main authenticated app (list + note editor), protected by middleware.js
  api/
    auth/[...nextauth]/         NextAuth handlers
    android-callback/           Issues one-time code + PKCE code_challenge, redirects back to the Android app
    exchange/                   Android app exchanges the one-time code (+ code_verifier) for a session cookie
    notes/                      CRUD for notes
    upload/                     Image upload to GCS
src/components/                 NoteEditor, Sidebar, UserMenu
src/lib/
  auth.js                       NextAuth config + hand-rolled Postgres adapter
  db.js                         pg Pool
src/middleware.js               Route protection for /notes
setup.sql                       Full DB schema (users, accounts, sessions, notes, android_auth_codes, ...)
docs/oauth-flow.md              Detailed writeup of the Android WebView <-> Custom Tab PKCE OAuth flow
docs/oauth-flow.puml            Sequence diagram (PlantUML) for the same flow
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

## Android WebView auth bridge

This is the most non-obvious part of the codebase. Because Google blocks OAuth from embedded WebViews, the Android app opens a Chrome Custom Tab to do the Google sign-in, then hands the resulting session back to the WebView via a PKCE-protected one-time-code exchange over a custom `intent://` deep link (package-pinned, so only this app's package can receive it). Full details, including the exact endpoints devs need to implement and why, are in `docs/oauth-flow.md` and the diagram `docs/oauth-flow.puml`. Read that doc before touching `android-signin/`, `api/android-callback/`, or `api/exchange/`.

## Current work in progress (as of this snapshot)

The Android auth bridge was recently hardened with PKCE (`code_challenge`/`code_verifier`) on top of the existing one-time-code exchange, and the deep link redirect was switched from a plain `notizen://` scheme to a package-pinned `intent://` URI to prevent interception by other apps. This touched:

- `setup.sql` — added `code_challenge` column to `android_auth_codes`
- `src/app/api/android-callback/route.js` — requires `code_challenge` param, stores it, redirects via explicit `intent://`
- `src/app/api/exchange/route.js` — requires `code_verifier`, verifies `SHA256(code_verifier) == code_challenge`, atomically deletes the code on lookup
- `src/app/android-signin/page.js`, `src/app/signin/page.js` (+ css) — client-side changes to generate/pass the PKCE pair

These changes were uncommitted at the time this repo was pushed — check `git log` and `git diff` on the initial commit's parent if you need the exact before/after, or just trust the current file contents as the latest intended state.

## Clever sign-in

See [Clever setup](docs/clever-login.md) for developer/sandbox access, callback registration, server-only configuration, and the original Custom Tab versus Auth Tab behavior. The button appears only after Clever is configured.
