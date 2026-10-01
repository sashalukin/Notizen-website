import crypto from 'node:crypto';

export const MIGRATION = `
ALTER TABLE notes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE TABLE IF NOT EXISTS note_operations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, operation_id)
);`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateOperation(op) {
  if (!op || !uuid.test(op.operationId) || !uuid.test(op.id) ||
      !['upsert', 'delete'].includes(op.kind) || !Number.isSafeInteger(op.baseVersion) || op.baseVersion < 0) return false;
  const p = op.payload;
  return !!p && typeof p.title === 'string' && p.title.length <= 10000 &&
    typeof p.content === 'string' && p.content.length <= 1000000 &&
    (p.remind_at === null || (typeof p.remind_at === 'string' && Number.isFinite(Date.parse(p.remind_at))));
}
export function createNotesStore(pool) {
  let migration;
  async function ready() {
    if (!migration) migration = (async () => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query("SELECT pg_advisory_xact_lock(724891331)");
        await c.query(MIGRATION);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
      finally { c.release(); }
    })().catch(e => { migration = null; throw e; });
    return migration;
  }
  async function list(userId, tombstones = false) {
    await ready();
    return (await pool.query(`SELECT id,title,content,remind_at,created_at,updated_at,version,deleted_at
      FROM notes WHERE user_id=$1 ${tombstones ? '' : 'AND deleted_at IS NULL'} ORDER BY updated_at DESC`, [userId])).rows;
  }
  async function apply(userId, op) {
    await ready();
    const c = await pool.connect();
    const hash = crypto.createHash('sha256').update(JSON.stringify([op.id, op.kind, op.baseVersion,
      op.payload.title, op.payload.content, op.payload.remind_at])).digest('hex');
    try {
      await c.query('BEGIN');
      // Serialize mutations for this account, including retries across Cloud Run instances.
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
      const prior = (await c.query('SELECT result,request_hash FROM note_operations WHERE user_id=$1 AND operation_id=$2', [userId, op.operationId])).rows[0];
      if (prior) {
        await c.query('COMMIT');
        return prior.request_hash === hash ? prior.result : { operationId: op.operationId, status: 'invalid', message: 'Operation ID was reused with different data.' };
      }
      // Looking up by owner never reveals another account's note.
      const existing = (await c.query('SELECT id,title,content,remind_at,created_at,updated_at,version,deleted_at FROM notes WHERE id=$1 AND user_id=$2 FOR UPDATE', [op.id, userId])).rows[0];
      let result;
      if ((!existing && op.baseVersion !== 0) || (existing && (existing.version !== op.baseVersion || existing.deleted_at))) {
        result = { operationId: op.operationId, status: 'conflict', note: existing || null };
      } else if (!existing && op.kind === 'delete') {
        result = { operationId: op.operationId, status: 'ok', note: { id: op.id, version: 0, deleted_at: new Date().toISOString() } };
      } else {
        const p = op.payload;
        let note;
        if (!existing) {
          note = (await c.query(`INSERT INTO notes (id,user_id,title,content,remind_at)
            VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING
            RETURNING id,title,content,remind_at,created_at,updated_at,version,deleted_at`,
          [op.id,userId,p.title,p.content,p.remind_at])).rows[0];
        } else {
          note = (await c.query(`UPDATE notes SET title=$3,content=$4,remind_at=$5,
            deleted_at=CASE WHEN $6 THEN NOW() ELSE NULL END, version=version+1,updated_at=NOW()
            WHERE id=$1 AND user_id=$2
            RETURNING id,title,content,remind_at,created_at,updated_at,version,deleted_at`,
          [op.id,userId,p.title,p.content,p.remind_at,op.kind === 'delete'])).rows[0];
        }
        result = note ? { operationId: op.operationId, status: 'ok', note } :
          { operationId: op.operationId, status: 'conflict', note: null };
      }
      await c.query('INSERT INTO note_operations(user_id,operation_id,request_hash,result) VALUES($1,$2,$3,$4)', [userId,op.operationId,hash,JSON.stringify(result)]);
      await c.query('COMMIT');
      return result;
    } catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); }
  }
  return { ready, list, apply };
}
