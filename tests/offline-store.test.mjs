import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as s from '../src/lib/offline/store.js';
const user = 'offline-tests';
const id = () => crypto.randomUUID();
test('dismissing a stale reminder cannot erase a newly scheduled reminder', async () => {
  const noteId = id(), first = '2026-09-27T12:00:00.000Z', next = '2026-09-28T12:00:00.000Z';
  await s.saveLocal(user, noteId, { remind_at: first }, true);
  await s.saveLocal(user, noteId, { remind_at: next });
  const before = (await s.readNotes(user)).find(n => n.id === noteId);
  const preserved = await s.saveLocal(user, noteId, { remind_at: null }, false, first);
  assert.equal(preserved.remind_at, next);
  assert.equal(preserved.localSeq, before.localSeq);
  const dismissed = await s.saveLocal(user, noteId, { remind_at: null }, false, next);
  assert.equal(dismissed.remind_at, null);
});
test('edit while upload is in flight preserves the newer draft and chains the version', async () => {
  const noteId = id();
  await s.saveLocal(user,noteId,{title:'first',content:'a'},true);
  const op = (await s.pending(user)).find(o => o.id===noteId);
  await s.saveLocal(user,noteId,{title:'second',content:'b'});
  assert.deepEqual((await s.pending(user)).find(o=>o.id===noteId),op);
  await s.acknowledge(user,op,{status:'ok',note:{id:noteId,...op.payload,version:1,updated_at:new Date().toISOString()}});
  const local = (await s.readNotes(user)).find(n=>n.id===noteId);
  assert.equal(local.title,'second'); assert.equal(local.dirty,true);
  const next = (await s.pending(user)).find(o=>o.id===noteId);
  assert.equal(next.baseVersion,1); assert.notEqual(next.operationId,op.operationId); assert.equal(next.payload.content,'b');
  await s.acknowledge(user,op,{status:'ok',note:{version:1}}); // delayed duplicate acknowledgement
  assert.equal((await s.pending(user)).find(o=>o.id===noteId).operationId,next.operationId);
  await s.acknowledge(user,next,{status:'ok',note:{id:noteId,...next.payload,version:2,updated_at:new Date().toISOString()}});
  assert.equal((await s.readNotes(user)).find(n=>n.id===noteId).dirty,false);
});
test('snapshots never overwrite pending local edits; keep both preserves the latest draft', async () => {
  const noteId=id();
  await s.mergeSnapshot(user,[{id:noteId,title:'remote',content:'old',version:1,updated_at:'2026-09-26T00:00:00.000Z'}]);
  await s.saveLocal(user,noteId,{title:'my title',content:'mine'});
  const op=(await s.pending(user)).find(o=>o.id===noteId);
  const remote={id:noteId,title:'their title',content:'theirs',version:2,updated_at:'2026-09-26T00:00:01.000Z'};
  await s.mergeSnapshot(user,[remote]);
  assert.equal((await s.readNotes(user)).find(n=>n.id===noteId).content,'mine');
  await s.acknowledge(user,op,{status:'conflict',note:remote});
  await s.saveLocal(user,noteId,{content:'even newer draft'});
  const copy=await s.resolveConflict(user,noteId,true);
  const rows=await s.readNotes(user);
  assert.equal(rows.find(n=>n.id===copy).content,'even newer draft');
  assert.equal(rows.find(n=>n.id===noteId).content,'theirs');
  assert.equal((await s.pending(user)).find(o=>o.id===copy).baseVersion,0);
});
test('offline delete during creation uploads the create then a versioned tombstone', async () => {
  const noteId=id();
  await s.saveLocal(user,noteId,{title:'to delete'},true);
  const create=(await s.pending(user)).find(o=>o.id===noteId);
  await s.saveLocal(user,noteId,{deleted_at:new Date().toISOString()});
  await s.acknowledge(user,create,{status:'ok',note:{id:noteId,version:1,deleted_at:null}});
  const deletion=(await s.pending(user)).find(o=>o.id===noteId);
  assert.equal(deletion.kind,'delete'); assert.equal(deletion.baseVersion,1);
});
test('account cleanup leaves other accounts and their pending edits untouched', async () => {
  const other='another-account',noteId=id();
  await s.saveLocal(other,noteId,{content:'private'},true);
  await s.setAccount({id:other});
  const db = await s.database();
  await db.put('meta', 'old-reminder', ['reminder-delivery', user, noteId]);
  await db.put('meta', 'other-reminder', ['reminder-delivery', other, noteId]);
  await s.clearAccount(user);
  assert.equal((await s.pending(user)).length,0);
  assert.equal((await s.readNotes(other))[0].content,'private');
  assert.equal((await s.account()).id,other);
  assert.equal(await db.get('meta', ['reminder-delivery', user, noteId]), undefined);
  assert.equal(await db.get('meta', ['reminder-delivery', other, noteId]), 'other-reminder');
});
test('lease excludes another tab and is only released by its owner', async () => {
  assert.equal(await s.lease(user,'tab-a'),true);
  assert.equal(await s.lease(user,'tab-b'),false);
  assert.equal(await s.lease(user,'tab-b',true),false);
  assert.equal(await s.lease(user,'tab-a',true),true);
  assert.equal(await s.lease(user,'tab-b'),true);
});
test('a late response from before logout cannot restore account data', async () => {
  const userId='logout-race';
  await s.setAccount({id:userId});
  const epoch=await s.sessionEpoch();
  await s.clearAccount(userId);
  await assert.rejects(s.setAccount({id:userId},epoch));
  await s.mergeSnapshot(userId,[{id:id(),content:'old private response',version:1}],epoch);
  assert.equal((await s.readNotes(userId)).length,0);
});
test('outbox write failure rolls back the note transaction too', async () => {
  const userId='quota-test',noteId=id();
  const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,...args) {
    if (this.name==='outbox' && value.userId===userId) throw new DOMException('Storage full','QuotaExceededError');
    return original.call(this,value,...args);
  };
  try {
    await assert.rejects(s.saveLocal(userId,noteId,{content:'must not be falsely saved'},true), {name:'QuotaExceededError'});
  } finally { IDBObjectStore.prototype.put=original; }
  assert.equal((await s.readNotes(userId)).length,0);
  assert.equal((await s.pending(userId)).length,0);
});
