import * as store from './store';
export class SyncFailure extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
async function request(path, init) {
  let response;
  try { response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...init, signal: AbortSignal.timeout(15000) }); }
  catch { throw new SyncFailure('Offline', 0); }
  if (!response.ok) throw new SyncFailure(response.status === 401 ? 'Sign in to sync' : 'Could not sync', response.status);
  return response.json();
}
export async function synchronize(onUser, onChange) {
  const epoch = await store.sessionEpoch();
  const snapshot = await request('/api/sync');
  await store.setAccount(snapshot.user, epoch);
  await onUser(snapshot.user);
  const userId = snapshot.user.id;
  const owner = crypto.randomUUID();
  if (!await store.lease(userId, owner)) return { busy: true };
  try {
    await store.mergeSnapshot(userId, snapshot.notes, epoch);
    await onChange();
    // Bounded runs avoid monopolizing the foreground. Further changes schedule another pass.
    for (let i = 0; i < 100; i++) {
      if (await store.sessionEpoch() !== epoch) return { busy: true };
      const op = (await store.pending(userId)).find(o => o.state === 'pending');
      if (!op) break;
      if (!await store.lease(userId, owner)) return { busy: true };
      const response = await request('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: userId, operations: [op] }) });
      await store.acknowledge(userId, op, response.results[0]);
      await onChange();
    }
    const latest = await request('/api/sync');
    if (latest.user.id !== userId) throw new SyncFailure('Account changed. Reconnecting…', 403);
    await store.mergeSnapshot(userId, latest.notes, epoch);
    await onChange();
    return { pending: (await store.pending(userId)).length };
  } finally { await store.lease(userId, owner, true); }
}
