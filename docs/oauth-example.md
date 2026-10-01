# Cookie-based Android OAuth example

This branch starts with a baseline commit removing only the old Android handoff.
The next commit adds a focused implementation. Normal Google website login,
notes, offline sync, uploads, and notifications remain in place.

Pair this branch with `example/webview-oauth` in `sashalukin/notizen`.
This is an **Auth.js JWT-cookie example**, not a bearer-token example.

## Read the implementation

1. `src/app/signin/page.js`: choose the native, origin-restricted sign-in bridge when available; otherwise use normal website login.
2. `src/app/android-signin/page.js`: validate the challenge and start the existing Auth.js Google flow in the Custom Tab.
3. `src/app/api/android-callback/route.js` and `src/lib/android-handoff.mjs`: authenticate the browser cookie, store a verifier-bound OTC, and render an explicit **Open Notizen** link. This deliberate user-tapped handoff avoids relying on browser auto-launch behavior.
4. `src/app/api/exchange/route.js`: atomically redeem the OTC with its verifier and return session cookies.
5. `src/lib/session-cookie.mjs`: shared cookie configuration and numbered-cookie serialization. The code preserves the original Auth.js encrypted session and expiration. Android removes stale chunks before installation.

Only the OTC travels through the intent link. Android generates and retains the
verifier. Provider authentication still uses the unchanged Google provider and
Auth.js callback. Existing Auth.js token-refresh behavior remains unchanged.

## Database and configuration

For a fresh database, use `setup.sql`. For an existing database, apply
`migrations/001-android-oauth.sql` before enabling the routes. It is additive;
any old `android_auth_codes` table is unused and is not dropped.
The migration was tested only against disposable local databases, not production.

`AUTH_URL` determines the canonical origin and secure session-cookie name;
it defaults to `https://notizen.dev`. Continue using the application's existing
Auth.js secret and Google configuration through its normal secure setup.
The paired Android example pins `https://notizen.dev` and its existing package.
Adapt **both** repositories together for another domain/package. Do not install
this example APK expecting it to work with the unchanged live handoff: it uses
the new `otc` contract and frontend bridge.

Application code never logs credentials or complete handoff URLs. If deploying,
configure ingress/access-log redaction for authentication query strings too;
application headers alone cannot control infrastructure logging.

## Verification

- `node --test tests/android-handoff.test.mjs`: starts/stops its own Unix-socket-only PostgreSQL cluster. Requires local PostgreSQL tools and a non-root user. Tests PKCE, authenticated issuance, wrong verifier without consumption, concurrent redemption, expiry, malformed input, and chunked-cookie authentication through Auth.js.
- `node scripts/test-db.mjs`, then `npm test`, then `node scripts/test-db.mjs --stop`: also exercise the existing note-sync integration tests in their disposable database.
- `npm run build`: normal production build. When dependencies are symlinked from another worktree, use `npx next build --webpack` and `node scripts/build-sw.mjs`; Turbopack rejects out-of-root dependency symlinks.
- Start a local built server and run `node scripts/test-oauth-ui.mjs http://127.0.0.1:3415`. It tests normal browser versus native routing and real route error responses. **Google/provider traffic is mocked.**

The reference passed local automated checks, not an interactive Google login on
an Android device. No device/emulator was connected. Before deployment, verify
real Custom Tab login, Open Notizen, warm/cold callbacks, rotation/cancellation,
the authenticated WebView, and subsequent app restart. Nothing in this branch
has been deployed or merged into the active development branch.
