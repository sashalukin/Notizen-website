# OAuth Flow: WebView ↔ Custom Tab with PKCE

This document explains the sequence diagram in `oauth-flow.puml`. It covers the full authentication flow for an Android WebView-based app that uses Google OAuth via Chrome Custom Tabs.

## PKCE Setup (Steps 1–4)

When the user taps "Sign in with Google", the WebView detects the navigation to GAIA (Google's authentication page) and intercepts it — because Google blocks OAuth from embedded WebViews (`403: disallowed_useragent`). Instead, the app opens a Chrome Custom Tab, which is a full browser that Google trusts.

Before opening the Custom Tab, the app generates a random `code_verifier` and computes `code_challenge = SHA256(code_verifier)`. The `code_challenge` is sent to the server as a query parameter. The `code_verifier` stays in the app's memory — it is never sent to the server at this point.

**Why PKCE?** Later in the flow, the server redirects to the app using an `intent://` URI with an explicit `package=` parameter, which ensures only the specified app receives the intent. This is the primary protection against interception. PKCE serves as a defense-in-depth layer — if the `intent://` delivery is ever bypassed (e.g., a bug in Chrome's intent handling, or a sideloaded app with the same package name), the one-time code is still useless without the `code_verifier` that only the original app has in memory.

## Google OAuth (Steps 5–16)

Devs need to create one custom endpoint — `/android-signin` (steps 5–6). This endpoint starts the Google OAuth flow and sets the post-OAuth redirect to `/api/android-callback?code_challenge=xxx`, which preserves the `code_challenge` through the OAuth detour. In most auth frameworks this is a simple server-side route that returns a 302 redirect to Google. In NextAuth specifically, it needs to be a page that calls `signIn()` client-side due to CSRF handling.

**Note on Google Console setup:** No additional redirect URIs need to be registered. The OAuth callback URL (`/api/auth/callback/google`) is the same one already configured for the web app's sign-in. The Android-specific endpoints (`/android-signin`, `/api/android-callback`) are never called by Google directly, so they don't need to be allowlisted.

Steps 7–16 are the standard Google OAuth flow — the account picker, token exchange, session creation, and cookie setting. Every modern auth library (NextAuth, Passport.js, Spring Security, Django allauth, Laravel Socialite) handles all of this automatically. Devs don't need to write any custom code for these steps. The only thing to note is that after OAuth completes, the auth library redirects to the callbackUrl that was set in step 5, which includes the `code_challenge` as a query parameter. The library doesn't know about `code_challenge` — it just preserves the full URL string and redirects to it.

## One-Time Code Generation (Steps 17–18)

**The problem:** After Google OAuth, the Custom Tab has a valid session (JWT in a cookie). But the WebView is a separate browser context — it has its own cookie jar and doesn't share cookies with the Custom Tab. We need to securely transfer the session from the Custom Tab to the WebView. We can't just pass the JWT directly via a URL — anyone who sees the URL gets the session.

**The solution:** The server generates a short-lived, single-use one-time code (OTC) and stores it in the database alongside the `code_challenge`. The OTC is then passed to the app via a deep link. The OTC is useless on its own because: (1) it expires after 60 seconds, (2) it can only be used once, and (3) with PKCE, it also requires the `code_verifier` to exchange.

**What devs need to implement:** One new endpoint — `/api/android-callback`. This endpoint:
1. Reads the session from the Custom Tab's cookie (JWT) to verify the user is authenticated
2. Generates a random one-time code
3. Stores the OTC and `code_challenge` in the database
4. Redirects to the app via `intent://` URI with explicit `package=` parameter, carrying the OTC

**Database:** Devs need one new table — something like `android_auth_codes` — with at least these columns:
- `code` (the OTC) — primary key
- `session_token` (the JWT to transfer to the WebView)
- `code_challenge` (from PKCE)
- `created_at` (timestamp, for expiry checks)

## Deep Link Handoff (Steps 19–20)

The server redirects the Custom Tab to an `intent://` URI with an explicit `package=` parameter (e.g., `intent://auth?otc=abc#Intent;scheme=notizen;package=com.google.android.samples.notizen;end`). Chrome delivers the intent only to the specified package — no other app can intercept it, even if it registers the same `notizen://` scheme. The Custom Tab closes and the app extracts the OTC from the intent.

## Token Exchange (Steps 21–25)

The WebView sends a POST request to `/api/exchange` with the OTC and the `code_verifier` that was generated in step 3. The server looks up the OTC, verifies that `SHA256(code_verifier)` matches the stored `code_challenge`, deletes the OTC (single use), and returns the JWT as a `Set-Cookie` header. The WebView is now authenticated.

**What devs need to implement:** One new endpoint — `/api/exchange`. This endpoint:
1. Receives `otc` and `code_verifier` from the POST body
2. Looks up the OTC in the database (must be less than 60 seconds old)
3. Verifies PKCE: `SHA256(code_verifier) == stored code_challenge`
4. Deletes the OTC row (prevents replay)
5. Returns the session token as a `Set-Cookie` header

This endpoint is not authenticated — it can't be, since the WebView has no session yet. The OTC + PKCE serve as the proof of identity instead.
