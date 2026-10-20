# Discord login with standard Custom Tabs

Current implementation: [Custom Tab flow](oauth-flow.md).
Both Google and Discord use the same browser-completed session handoff in Android.
The Auth Tab experiment is preserved only on its historical branch.

Add a Discord application at https://discord.com/developers/applications and register
exactly `https://notizen.dev/api/auth/callback/discord` under OAuth2 redirects.
Basic OAuth login does not need a bot installation or server permissions.

## Server configuration

- `AUTH_DISCORD_ID`: the application's public client ID (1556796058204508232 for this setup).
- `AUTH_DISCORD_SECRET`: a fresh client secret, server-side only.

If a secret was shared in chat, reset it in the Discord portal before use. Enter its
replacement directly in Google Cloud Secret Manager through the console, never in
chat, Git, Android resources, command arguments, or browser code. Bind the secret to
`AUTH_DISCORD_SECRET` in Cloud Run while preserving all existing environment and
secret bindings. The button remains hidden until both variables are configured.
Deploy the website code as well; changing only the environment does not add a provider.

## Flow

1. The website's Discord button sends a message through the origin-restricted Android bridge.
2. Android opens `/android-signin?provider=discord&code_challenge=...` in a standard Custom Tab.
3. Auth.js starts and completes Discord authentication in Chrome, retaining its state cookie there.
4. Auth.js verifies state and exchanges the provider code server-side using HTTP Basic
   client authentication. It fetches `/api/users/@me` and creates the normal browser session.
5. `/api/android-callback` issues a short-lived, single-use handoff code bound to Android's challenge.
6. Android receives the `notizen://auth` callback and redeems the code plus its verifier at
   `/api/exchange`. It waits for all session cookies to be saved before loading notes in WebView.

This uses `checks: ['state']`, not PKCE, for the documented confidential-client flow.
Only `identify` is requested, not email or any server/bot permissions. Discord uses a
stable provider user ID. Its Notizen account is separate from an existing Google
account; no automatic account linking or note migration is performed.
Use Android branch `fix/restore-custom-tabs` and a Custom Tabs-capable browser.
This flow does not use Auth Tab or require its HTTPS callback domain verification.
The provider OAuth state check and the app-session handoff PKCE check are separate.

Automated tests simulate Discord and exercise Auth.js state validation, code exchange,
session creation, callback replay and denial. Real Discord login still needs a device
check after the server configuration and deployment. Test cancellation, retry,
sign-out, and reopening too. Never log real authorization URLs or callback codes.

Reference: https://docs.discord.com/developers/topics/oauth2#authorization-code-grant
