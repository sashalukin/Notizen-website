# Discord login with Auth Tab

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

1. WebView starts the existing Auth.js Discord sign-in route, retaining its state cookie.
2. Android intercepts `https://discord.com/api/oauth2/authorize` (also accepts the
   documented `/oauth2/authorize` path on the exact same host) and opens Auth Tab.
3. Auth Tab captures `/api/auth/callback/discord` on `notizen.dev`.
4. Android checks the pending provider and state and loads the callback in the original WebView.
5. Auth.js verifies the state cookie and exchanges the code server-side using HTTP Basic
   client authentication. It fetches `/api/users/@me` and creates the normal session.

This uses `checks: ['state']`, not PKCE, for the documented confidential-client flow.
Only `identify` is requested, not email or any server/bot permissions. Discord uses a
stable provider user ID. Its Notizen account is separate from an existing Google
account; no automatic account linking or note migration is performed.
No `/android-signin`, `/api/android-callback`, or `/api/exchange` is used by the
Auth Tab app. This production compatibility branch preserves those routes for
Google login in older Android versions.

Use Android branch `experiment/auth-tab-no-handoff`, Chrome 137+ or another Auth Tab
browser, and an app signing certificate listed in the site's assetlinks.json.
The existing website association also covers this callback path.

Automated tests simulate Discord and exercise Auth.js state validation, code exchange,
session creation, callback replay and denial. Real Discord login still needs a device
check after the server configuration and deployment. Test cancellation, retry,
sign-out, and reopening too. Never log real authorization URLs or callback codes.

Reference: https://docs.discord.com/developers/topics/oauth2#authorization-code-grant
