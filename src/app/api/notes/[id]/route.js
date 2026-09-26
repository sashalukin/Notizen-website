import { auth } from '@/lib/auth';
import pool from '@/lib/db';
import { notesStore } from '@/lib/server-notes';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await notesStore.ready();
  const { id } = await params;
  const result = await pool.query(
    'SELECT id, title, content, created_at, updated_at, remind_at, version FROM notes WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [id, session.user.id]
  );

  if (result.rows.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json(result.rows[0]);
}

export async function PUT(request, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await notesStore.ready();
  const { id } = await params;
  const body = await request.json();

  // Verify ownership
  const check = await pool.query(
    'SELECT id FROM notes WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [id, session.user.id]
  );
  if (check.rows.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  if (!Number.isInteger(body.version)) return Response.json({ error: 'Reload Notizen to update this note.' }, { status: 428 });
  const queryParams = [id, body.title, body.content, session.user.id, body.version];
  let remindAtClause = '';
  if ('remind_at' in body) {
    queryParams.push(body.remind_at);
    remindAtClause = `, remind_at = $${queryParams.length}`;
  }

  const result = await pool.query(
    `UPDATE notes SET title = COALESCE($2, title), content = COALESCE($3, content)${remindAtClause}, updated_at = NOW(), version=version+1 WHERE id = $1 AND user_id=$4 AND version=$5 AND deleted_at IS NULL RETURNING id, title, content, remind_at, updated_at`,
    queryParams
  );

  if (!result.rows.length) return Response.json({ error: 'Note changed. Reload to resolve.' }, { status: 409 });
  return Response.json(result.rows[0]);
}

export async function DELETE(request, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await notesStore.ready();
  const { id } = await params;
  const expected = Number(request.headers.get('if-match'));
  if (!Number.isInteger(expected) || expected < 1) return Response.json({ error: 'Reload Notizen to delete this note.' }, { status: 428 });
  const result = await pool.query(
    'UPDATE notes SET deleted_at=NOW(), updated_at=NOW(), version=version+1 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND version=$3 RETURNING id',
    [id, session.user.id, expected]
  );

  if (result.rows.length === 0) {
    return Response.json({ error: 'Note changed. Reload to resolve.' }, { status: 409 });
  }

  return Response.json({ deleted: true });
}
