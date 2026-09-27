import { openDB } from 'idb';
let opened;
export function database() {
  if (!opened) opened = openDB('notizen-offline', 1, {
    upgrade(db) {
      db.createObjectStore('meta');
      db.createObjectStore('notes', { keyPath: ['userId', 'id'] }).createIndex('user', 'userId');
      db.createObjectStore('outbox', { keyPath: ['userId', 'id'] }).createIndex('user', 'userId');
    },
    blocking() { opened?.then(db => db.close()); opened = null; },
    terminated() { opened = null; },
  }).catch(e => { opened = null; throw e; });
  return opened;
}
const payload = n => ({ title: n.title || '', content: n.content || '', remind_at: n.remind_at || null });
function operation(n) {
  return { userId: n.userId, id: n.id, operationId: crypto.randomUUID(), kind: n.deleted_at ? 'delete' : 'upsert',
    baseVersion: n.version || 0, payload: payload(n), localSeq: n.localSeq, state: 'pending' };
}
export async function account() { return (await database()).get('meta', 'account'); }
export async function sessionEpoch() { return (await (await database()).get('meta', 'sessionEpoch')) || 0; }
export async function setAccount(user, expectedEpoch) {
  const tx = (await database()).transaction('meta', 'readwrite');
  if (expectedEpoch !== undefined && ((await tx.store.get('sessionEpoch')) || 0) !== expectedEpoch) {
    await tx.done; throw new Error('Session changed during synchronization.');
  }
  await tx.store.put(user, 'account');
  await tx.done;
}
export async function readNotes(userId) { return (await database()).getAllFromIndex('notes', 'user', userId); }
export async function pending(userId) { return (await database()).getAllFromIndex('outbox', 'user', userId); }
export async function saveLocal(userId, id, changes, create = false, expectedReminder) {
  const db = await database();
  const tx = db.transaction(['notes', 'outbox'], 'readwrite');
  tx.done.catch(() => {});
  try {
  const notes = tx.objectStore('notes'), outbox = tx.objectStore('outbox');
  const old = await notes.get([userId, id]);
  if (!old && !create) { tx.abort(); throw new Error('This note is no longer available.'); }
  // Dismissing an old alert must not clear a reminder rescheduled in another tab.
  if (expectedReminder !== undefined && old?.remind_at !== expectedReminder) {
    await tx.done;
    return old;
  }
  const now = new Date().toISOString();
  const note = { title: '', content: '', remind_at: null, version: 0, created_at: now,
    ...old, ...changes, id, userId, dirty: true, localSeq: (old?.localSeq || 0) + 1, updated_at: now };
  await notes.put(note);
  // An operation's payload never changes after creation: a timeout may hide a successful commit.
  if (!(await outbox.get([userId, id]))) await outbox.put(operation(note));
  await tx.done;
  return note;
  } catch (e) {
    try { tx.abort(); } catch {}
    await tx.done.catch(() => {});
    throw e;
  }
}
export async function acknowledge(userId, sent, result) {
  const db = await database();
  const tx = db.transaction(['notes', 'outbox'], 'readwrite');
  const notes = tx.objectStore('notes'), outbox = tx.objectStore('outbox');
  const key = [userId, sent.id];
  const currentOp = await outbox.get(key), note = await notes.get(key);
  if (!note || currentOp?.operationId !== sent.operationId) { await tx.done; return; }
  if (result.status !== 'ok') {
    note.conflict = result.status === 'conflict' ? { server: result.note } : null;
    note.syncError = result.status === 'invalid' ? result.message : null;
    await notes.put(note);
    await outbox.put({ ...currentOp, state: result.status });
  } else {
    await outbox.delete(key);
    if (note.localSeq === sent.localSeq) {
      await notes.put({ ...note, ...result.note, userId, dirty: false, conflict: null, syncError: null });
    } else {
      // Preserve edits made while the request was in flight and chain them onto the acknowledged version.
      const next = { ...note, version: result.note.version, conflict: null, syncError: null };
      await notes.put(next);
      await outbox.put(operation(next));
    }
  }
  await tx.done;
}
export async function mergeSnapshot(userId, remote, expectedEpoch) {
  const db = await database();
  const tx = db.transaction(['notes', 'meta'], 'readwrite');
  if (expectedEpoch !== undefined && ((await tx.objectStore('meta').get('sessionEpoch')) || 0) !== expectedEpoch) { await tx.done; return; }
  const notes = tx.objectStore('notes');
  const current = await notes.index('user').getAll(userId);
  const byId = new Map(current.map(n => [n.id, n]));
  for (const row of remote) {
    const local = byId.get(row.id);
    if (!local?.dirty && (!local || row.version >= local.version)) {
      await notes.put({ ...row, userId, localSeq: local?.localSeq || 0, dirty: false });
    }
  }
  // Deletions arrive as tombstones, not absence in a possibly stale/incomplete snapshot.
  await tx.done;
}
export async function resolveConflict(userId, id, keepBoth) {
  const db = await database();
  const tx = db.transaction(['notes', 'outbox'], 'readwrite');
  const notes = tx.objectStore('notes'), outbox = tx.objectStore('outbox');
  const old = await notes.get([userId, id]);
  if (!old?.conflict) { await tx.done; return; }
  let copy;
  if (keepBoth) {
    copy = { ...old, id: crypto.randomUUID(), title: `${old.title || 'Untitled'} (conflict copy)`, version: 0,
      deleted_at: null, conflict: null, syncError: null, dirty: true, localSeq: 1, updated_at: new Date().toISOString() };
    await notes.put(copy);
    await outbox.put(operation(copy));
  }
  await outbox.delete([userId, id]);
  if (old.conflict.server) await notes.put({ ...old.conflict.server, userId, dirty: false, localSeq: 0 });
  else await notes.delete([userId, id]);
  await tx.done;
  return copy?.id;
}
export async function clearAccount(userId) {
  const db = await database();
  const tx = db.transaction(['notes', 'outbox', 'meta'], 'readwrite');
  for (const table of ['notes','outbox']) {
    for (const key of await tx.objectStore(table).index('user').getAllKeys(userId)) await tx.objectStore(table).delete(key);
  }
  const epoch = (await tx.objectStore('meta').get('sessionEpoch')) || 0;
  for (const key of await tx.objectStore('meta').getAllKeys()) {
    if (Array.isArray(key) && key[0] === 'reminder-delivery' && key[1] === userId) await tx.objectStore('meta').delete(key);
  }
  await tx.objectStore('meta').put(epoch + 1, 'sessionEpoch');
  const active = await tx.objectStore('meta').get('account');
  if (active?.id === userId) await tx.objectStore('meta').delete('account');
  await tx.done;
}
// A lease works even in WebViews without navigator.locks. Idempotency remains the server-side backstop.
export async function lease(userId, owner, release = false) {
  const db = await database();
  const tx = db.transaction('meta', 'readwrite');
  const key = `lease:${userId}`, old = await tx.store.get(key);
  const allowed = !old || old.owner === owner || old.expires < Date.now();
  if (allowed) {
    if (release) await tx.store.delete(key);
    else await tx.store.put({ owner, expires: Date.now() + 45000 }, key);
  }
  await tx.done;
  return allowed;
}
