import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createNotesStore, validateOperation } from '../src/lib/notes-store.js';
let config;
try { config = JSON.parse(await readFile('/tmp/notizen-test-db.json','utf8')); } catch {}
const integration = config ? test : test.skip;
integration('PostgreSQL: concurrent retries, stale versions, account isolation and deletion tombstones', async () => {
  const pool = new pg.Pool(config);
  try {
    await pool.query(await readFile('setup.sql','utf8'));
    const store = createNotesStore(pool);
    const user = crypto.randomUUID(), other = crypto.randomUUID(), note = crypto.randomUUID();
    await pool.query('INSERT INTO users(id,name) VALUES($1,$2),($3,$4)',[user,'Test',other,'Other']);
    const op = { id: note,operationId:crypto.randomUUID(),kind:'upsert',baseVersion:0,payload:{title:'Title',content:'Hello',remind_at:null} };
    assert.equal(validateOperation(op),true);
    const results = await Promise.all([store.apply(user,op),store.apply(user,op)]);
    assert.deepEqual(JSON.parse(JSON.stringify(results[0])),JSON.parse(JSON.stringify(results[1])));
    assert.equal((await store.list(user))[0].version,1);
    assert.equal((await store.list(other)).length,0);
    const foreign = await store.apply(other,{...op,operationId:crypto.randomUUID()});
    assert.equal(foreign.status,'conflict'); assert.equal(foreign.note,null);
    const reused = await store.apply(user,{...op,payload:{...op.payload,content:'changed retry'}});
    assert.equal(reused.status,'invalid');
    const update={...op,operationId:crypto.randomUUID(),baseVersion:1,payload:{...op.payload,content:'device A'}};
    assert.equal((await store.apply(user,update)).note.version,2);
    const conflict=await store.apply(user,{...update,operationId:crypto.randomUUID(),payload:{...op.payload,content:'device B'}});
    assert.equal(conflict.status,'conflict'); assert.equal(conflict.note.content,'device A');
    const deletion=await store.apply(user,{...update,operationId:crypto.randomUUID(),baseVersion:2,kind:'delete'});
    assert.ok(deletion.note.deleted_at);
    assert.equal((await store.list(user)).length,0);
    assert.equal((await store.list(user,true))[0].version,3);
    const resurrection=await store.apply(user,{...op,operationId:crypto.randomUUID()});
    assert.equal(resurrection.status,'conflict');
    assert.equal((await store.apply(user,update)).note.version,2); // retry returns its original acknowledgement
    assert.equal((await store.list(user,true))[0].version,3); // retry cannot resurrect or reapply
  } finally { await pool.end(); }
});
