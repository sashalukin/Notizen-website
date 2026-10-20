# Clever and ClassLink sign-in

Implemented on `fix/restore-custom-tabs` in the website and Android repositories.
Both login pages show **Sign in with Clever** and **Sign in with ClassLink** below
Google and Discord. Each is disabled with “Not available yet” until its server
client ID and secret are configured. Existing Google/Discord sign-in is unchanged.

## Required application access (student accounts are not application credentials)

For each provider, register a Notizen OAuth application with SSO access and authorize
it for the test student's school/district. Register these exact HTTPS redirect URIs:

- Clever: `https://notizen.dev/api/auth/callback/clever`
- ClassLink: `https://notizen.dev/api/auth/callback/classlink`

Clever developer setup: https://www.clever.com/developer-signup
ClassLink partner setup: https://www.classlink.com/company/prospective-partners
Clever currently documents a Clever Complete requirement for this SSO integration.
Having a student login does not establish access to either developer console.
For Clever sandbox schools, also obtain the sandbox district ID: these schools are
not searchable in the normal picker.

## Secure server configuration

Use Google Cloud Secret Manager in the **Notizen** project (`notizen-489117`),
as with the existing Discord configuration. Enter values through the Cloud console,
not chat, Git, Android resources, URLs, shell arguments, or browser JavaScript.

| Secret name | Runtime environment variable |
| --- | --- |
| `notizen-clever-id` | `AUTH_CLEVER_ID` |
| `notizen-clever-secret` | `AUTH_CLEVER_SECRET` |
| `notizen-classlink-id` | `AUTH_CLASSLINK_ID` |
| `notizen-classlink-secret` | `AUTH_CLASSLINK_SECRET` |

Optional Clever sandbox setting: `AUTH_CLEVER_DISTRICT_ID` (public district identifier).
Tell the maintainer only that configuration is saved, and the project/secret names.
The website runs in `main-tokenizer-485420-h8`; its runtime identity needs access to
these secrets and Cloud Run references must be added while preserving existing settings.
After configuration, deploy a new revision; providers are selected at server startup.

No student password is stored or submitted by Notizen: the student signs in directly
on the provider's page inside Chrome. No extra assetlinks.json entry, Android signing
fingerprint, or new handoff endpoint is required. Android must be updated to the latest
`fix/restore-custom-tabs` commit to recognize ClassLink.

## Flow and scope

All four providers use the existing standard Custom Tab flow: native SIGN_IN bridge →
`/android-signin?provider=...&code_challenge=...` → Auth.js provider login in Chrome →
`/api/android-callback` → app's `notizen://auth` callback → `/api/exchange` → saved
WebView session cookies. Neither school integration uses Auth Tab.

Clever uses authorization code + state, HTTP Basic client authentication, versioned
`/v3.0/me` and `/v3.0/users/{id}`. ClassLink uses OneClick OAuth2 authorization code +
state, server-side client_secret_post, `profile` scope and `/v2/my/info`. No roster,
class membership, or full-data scopes are requested. PKCE for the Notizen session
handoff is separate from the provider's own OAuth flow.

ClassLink account keys include TenantId and UserId. Clever uses the stable v3 user ID.
No automatic email-based account merging is enabled; an email matching another login
may produce an account-not-linked error. A new school account does not inherit another
account's notes.

This implementation supports login initiated by the Notizen buttons. Unsolicited
portal callbacks without the matching state are rejected. Provider account registration,
district access, token response details and a full real-device login still need validation
with the issued client credentials; automated tests simulate provider services.

## Verification

- `npm test` exercises all four Auth.js flows, state rejection/replay, school identity
  validation, cookie persistence and the existing PostgreSQL handoff tests.
- After `npm run build` and starting locally on 127.0.0.1:3217,
  `node tests/cct-buttons.browser.mjs` checks configured and unconfigured buttons,
  native bridge selection, normal browser login, and Custom Tab destinations.
- Android: `:app:compileDebugKotlin :app:testDebugUnitTest :app:lintDebug`.

## Official references

- https://dev.clever.com/docs/oauth-implementation
- https://github.com/classlinkinc/request-libraries/tree/master/classlink-oauth2
- https://help.classlink.com/s/article/v2-my-info
