import { auth } from '@/lib/auth';
import pool from '@/lib/db';

export async function GET(request, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const result = await pool.query(
    'SELECT id, title, content, created_at, updated_at FROM notes WHERE id = $1 AND user_id = $2',
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

  const { id } = await params;
  const body = await request.json();

  // Verify ownership
  const check = await pool.query(
    'SELECT id FROM notes WHERE id = $1 AND user_id = $2',
    [id, session.user.id]
  );
  if (check.rows.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const result = await pool.query(
    'UPDATE notes SET title = COALESCE($2, title), content = COALESCE($3, content), updated_at = NOW() WHERE id = $1 RETURNING id, title, content, updated_at',
    [id, body.title, body.content]
  );

  return Response.json(result.rows[0]);
}

export async function DELETE(request, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const result = await pool.query(
    'DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, session.user.id]
  );

  if (result.rows.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json({ deleted: true });
}
