# Audio attachments

Use **Attach audio** in the note toolbar. Files up to 20 MiB are uploaded through
`POST /api/upload` with `kind=audio`. MP3, M4A/MP4, WAV, OGG/Opus, WebM, FLAC and
AAC container signatures are accepted. Codec support depends on the browser.
Uploads require an authenticated session and same-origin requests. Multipart
bodies are bounded while reading, and generated extensions/content types come
from the detected format, not the supplied filename.

An attachment is a non-editable figure in the existing note HTML: escaped filename,
native audio controls (`preload=metadata`, no autoplay), and Remove button. Its URL
uses normal local note persistence and synchronization; there is no schema change.
Removing a player removes its reference from this note, not the storage object
(which another note/conflict copy may still reference). Upload completion appends
to the latest editor contents and is aborted when leaving the editor.

Production uses the existing Cloud Storage bucket and its existing URL/access
model, as image uploads do. Local development uses an authenticated streaming route
under `/api/uploads/` with byte-range support. Audio never enters the service
worker's image cache; full offline audio downloads and recording are not included.
Text notes continue to work offline. This is browser playback, not native Android
background audio or a foreground media service.

Checks: `npm run build`, `node --test tests/upload-files.test.mjs`, then
`node scripts/test-db.mjs` and `node scripts/test-audio.mjs`. The browser test
uploads an actual generated WAV, plays/seeks it, reloads the note, removes it, and
checks auth, wrong-origin/disguised-file rejection, offline and server-failure UI.
