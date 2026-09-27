# Foreground Android reminder notifications

The web app owns reminder scheduling, IndexedDB state and note synchronization.
Android is a display adapter, not a second scheduler. Browser delivery remains
through the service worker. No Firebase, backend endpoints, background jobs or
notification retries are used.

## Bridge v1

Android registers `AndroidNotifications` with AndroidX WebKit before loading each
regular app WebView, for the exact origin `https://notizen.dev`, main frame only.
Popup WebViews do not receive the bridge. Capability detection selects the adapter.

- `GET_STATE`, `REQUEST_PERMISSION`: contain `requestId`; response contains the
  same ID, `permission` (`default`, `granted`, `denied`) and `active`.
- `SHOW_NOTIFICATION`: `notificationId`, `title`, `body`, `noteId`. One-way;
  **no acknowledgment or retry**. Native triggers reset the bell regardless of
  Android notification settings. The existing receipt prevents replay on reload.
- `CLOSE_NOTIFICATION`: `notificationId`, for explicit cancellation.
- `CLEAR_NOTIFICATIONS`: clear displayed native notifications on logout/account change.

Permission prompts require the explicit Enable notifications action. Android
checks runtime, app-wide and channel permissions. The native channel is fixed to
Reminders; JavaScript cannot select channels, execute intents or supply arbitrary
URLs. Notification text is bounded; note IDs must be UUIDs.

Both the scheduler and native display guard foreground delivery. Native checks the
Activity is resumed, the originating WebView is active/shown and its window has
focus. A due reminder in an inactive WebView remains pending until foregrounded.
Android rechecks before posting; a background transition between query and posting
may suppress that one-way trigger. There is deliberately no redelivery guarantee.

The same browser title, body and note target are used. A tap opens/selects a note
tab without replacing another editor. Previously displayed notifications can remain
in the tray after leaving the app. Notifications due while away are considered on
reopening; no background notification is scheduled.

## Verification

- `npm run build`
- `node scripts/test-db.mjs` (isolated database)
- `node scripts/test-native-reminders.mjs` (mock bridge, real app/storage)
- `xvfb-run -a node scripts/test-reminders.mjs` (browser regression)
- Android repo: `./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug`

Robolectric tests cover native validation, permission/channel blocking, notification
payloads, immutable tap intents, duplicate replacement and cleanup. Actual WebView
bridge transport, permission dialog and OS popup/tap UX still need device testing.
The website is backward-compatible with older APKs; native notifications require
the updated APK. Debug APKs may not match the signature of an existing installation;
do not uninstall an existing app with unsynchronized notes to force an update.
