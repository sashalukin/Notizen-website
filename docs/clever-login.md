# Clever login setup

This adds app-initiated **Continue with Clever**, using the existing Auth.js handler
at `/api/auth/callback/clever`. Google login remains unchanged. The button is hidden
until both `AUTH_CLEVER_ID` and `AUTH_CLEVER_SECRET` are configured on the server.

## Account and configuration

1. Register a developer application at https://www.clever.com/developer-signup.
   Clever documents SSO as requiring Clever Complete access; developer/sandbox access
   may require their approval. No subscription is purchased by this change.
2. Enable Single Sign-On and obtain a sandbox district and test student/teacher.
   A normal Google account by itself is not a Clever test account.
3. Register the exact redirect URI `https://notizen.dev/api/auth/callback/clever`.
4. Configure server-only `AUTH_CLEVER_ID` and `AUTH_CLEVER_SECRET` using Google Cloud
   Secret Manager and Cloud Run secret environment references. Do not put credentials
   in Git, Android code, browser JavaScript, command arguments, or chat. Keep existing
   Cloud Run secret references when adding these two.
5. For sandbox testing set optional `AUTH_CLEVER_DISTRICT_ID` to the sandbox district
   ID. Sandbox schools cannot be found through the normal school picker. Remove this
   setting for a general production school picker.
6. Deploy the configured website, install the appropriate Android branch, and test
   login, cancellation, retry, sign-out, and reopening. HTTPS Auth Tab requires a
   supported browser and the installed app's certificate in `assetlinks.json`.

## Authentication behavior

The custom OAuth provider uses `https://clever.com/oauth/authorize`, server-side
HTTP Basic client authentication at `https://clever.com/oauth/tokens`, and a required
Auth.js state cookie. It does not assume Clever supports PKCE. The server identifies
the user through `/v3.0/me` followed by `/v3.0/users/{id}` on `api.clever.com`.
No full roster synchronization is requested. Missing email is supported; the stable
Clever v3 user ID is the provider account identifier. Accounts are not automatically
linked to Google accounts by email. Matching an existing account's email may produce
Auth.js's account-not-linked error, rather than silently merging private notes.

The original Custom Tab version selects Clever through the existing `/android-signin`
route and uses the existing handoff. The Auth Tab experiment instead captures the
Clever authorize navigation and returns `/api/auth/callback/clever` to the originating
WebView. No application handoff endpoints are used by that version.

This first integration supports login initiated by the Notizen button. Unsolicited
Clever Portal/Instant Login callbacks without the matching state cookie are rejected;
start from Notizen instead. State validation is not disabled to support those links.

Automated tests simulate Clever while exercising the installed Auth.js flow. Real
Clever login remains unverified until the developer app and sandbox are configured.

References:
- https://dev.clever.com/docs/oauth-implementation
- https://dev.clever.com/docs/example-oauth-walkthrough
