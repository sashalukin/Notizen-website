# Offline notes

## User behavior

Open Notizen and sign in online once on each browser/device. Allow the initial notes and offline app files to download before disconnecting. Note text is then available offline, including after reloading or reopening the app. Notes can be created, edited and deleted locally. The small status strip stays hidden during normal online use. After an outage it shows “No internet”, then green “Back online”, a sync spinner and “Synchronized”, and disappears three seconds after synchronization finishes. Editor “Saved on device” appears only while offline and is distinct from server acknowledgement; save failures remain visible regardless of connectivity.

Synchronization runs on connection restoration, focus/visibility/resume, shortly after local edits, and every 30 seconds while visible. Android `MainActivity.onResume` also dispatches `notizen-resume`. Android WebView Background Sync is not assumed. Nothing promises uploading while the application is closed.

Conflicts preserve the draft and offer **Keep both** (creates a conflict copy) or **Use server version** (explicit discard confirmation). Sign-out requires connectivity and no pending changes; account-scoped local records are removed after sign-out. Expired authentication retains local notes and pauses uploads until sign-in.

Existing note images are cached opportunistically, up to 80 URLs, separately from text. New image uploads require a connection. Browser storage can be cleared/evicted by the user or platform; persistence is requested when supported, not guaranteed. Storage write failures are surfaced without reporting a successful save.

## Implementation

- `src/lib/offline/store.js`: IndexedDB `notes`, `outbox`, `meta`. Local mutation and pending operation creation share a transaction. Operations are immutable once queued. Further edits remain in the note and become a successor operation after acknowledgement, so retries never reuse an operation ID with a changed payload.
- `src/lib/offline/sync.js`: account validation, bounded mutation processing, 15-second request timeouts, renewable cross-tab lease and snapshot merging. Full account snapshots include tombstones; dirty local rows are never overwritten by downloads. Logout epochs reject late responses that could repopulate cleared data.
- `src/app/api/sync/route.js`: authenticated snapshots and same-origin, account-bound operation batches.
- `src/lib/notes-store.js`: additive, transactional migration protected by a PostgreSQL advisory lock. Adds `notes.version`, `notes.deleted_at`, and `note_operations`. Mutations, version checks and idempotency receipts commit together. Conflicts are also repeatable receipts. Receipts and tombstones are retained; a future cleanup policy must preserve replay safety. Full snapshots are appropriate for the current small notes app; large collections should add pagination/delta synchronization before scaling.
- Legacy REST mutations increment versions and use tombstones. PUT requires a note `version`; DELETE requires `If-Match` containing the numeric version. Older open clients must reload instead of overwriting newer data without a version.
- `scripts/build-sw.mjs` creates `public/sw.js` from the current Next build. It precaches the public `/offline` shell and static assets, not authenticated HTML/API responses. `/notes/:id` cold offline navigation falls back to that shell; selection/navigation uses client history and IndexedDB, so local-only UUIDs never need an RSC response.
- `/notes` and `/offline` contain no user data in server HTML. APIs remain authenticated. Cached local data is scoped by verified account ID.
- Service-worker updates wait for old controlled tabs to close; they do not force-reload an active editor. Shell caches are replaced on activation, separately from IndexedDB and image caches.

## Tests

Requires Node 20+, PostgreSQL binaries (`pg_config` on PATH), and Playwright Chromium.

```sh
npm ci
npx playwright install chromium --only-shell
node scripts/test-db.mjs
npm test
npm run build
node scripts/test-offline.mjs
node scripts/test-db.mjs --stop
```

The test database is a disposable Unix-socket-only cluster, not production. The browser test generates short-lived local-only authentication in memory; no production credentials or authentication bypass are part of the app.

Coverage: offline deep-link reload, create/close/reopen, reconnection, independent-device conflicts, session expiry and resume, offline deletion, account isolation, lost response/retry, logout, local transaction failure, edits during upload, concurrent PostgreSQL retries and tombstones. Screenshots go to `/tmp/notizen-offline-artifacts`. Android debug build verifies Kotlin integration; physical-device lifecycle/airplane-mode testing is still needed.

## Deployment

No new environment variables are needed. The existing runtime database user must be allowed to run the additive migration. A successful authenticated GET `/api/sync` executes/verifies it before traffic promotion. Do not use the old `setup.sql` as an upgrade migration.

Deployment uses the existing Cloud Run service `notizen` in project `main-tokenizer-485420-h8`, region `us-central1`, preserving runtime configuration. Build the committed source, deploy with no traffic, verify the new revision and migration, then promote. Record the previous revision before promotion.

Rollback caveat: the old application does not understand tombstones. After offline mutations begin, rolling back to the pre-offline image can reveal deleted notes or bypass revision checks. Prefer a forward fix; do not treat the old image as a data-compatible rollback without adding the same tombstone/version behavior.

## Reminders

Reminders are currently checked while the website/WebView is running, and overdue reminders can notify when it resumes or reopens. They are not scheduled by a server, Web Push, or native Android background service. Closing or suspending Notizen can delay delivery.

After choosing a future reminder time, use **Enable notifications** if the browser has not granted permission. Once allowed, **Test notification** uses the same delivery path without consuming the scheduled reminder. Browser acceptance does not prove an OS popup was visible: check the browser/OS notification settings and Focus/Do Not Disturb if a test is accepted but not visible. Blocked permissions must be changed in browser/site settings. Supported browsers use `ServiceWorkerRegistration.showNotification`; clicking the notification opens the note. Android WebView has no Web Notifications API, so the existing Android app cannot deliver system reminders.

There is no in-app “Reminder: …” banner. After the browser accepts a due notification, its reminder resets automatically on the device and synchronizes to the server. The notification itself remains available to read/click; resetting the bell does not immediately close it. Acceptance receipts survive reloads, and tabs coordinate delivery using Web Locks when available. Notification denial or delivery failure does not delete the reminder: failures show inline with Retry, and retry automatically after 30 seconds or on resume. The bell still cancels a pending reminder. Re-scheduling the same note creates a new notification identity. Native Android system notifications and closed-app delivery require a separate implementation.

Verification: `node scripts/test-db.mjs`, `npm run build`, `xvfb-run -a node scripts/test-reminders.mjs`, then `node scripts/test-db.mjs --stop`. Tests use an isolated local database; no production notes are accessed. The reminder check needs full Chromium (`npx playwright install chromium`); headless-shell notification permissions are not representative of a normal browser.
