import { auth } from '@/lib/auth';
import pool from '@/lib/db';
import crypto from 'crypto';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await pool.query(
    'SELECT id, title, content, updated_at FROM notes WHERE user_id = $1 ORDER BY updated_at DESC',
    [session.user.id]
  );

  return Response.json(result.rows);
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = crypto.randomUUID();
  const result = await pool.query(
    'INSERT INTO notes (id, user_id) VALUES ($1, $2) RETURNING id, title, content, created_at, updated_at',
    [id, session.user.id]
  );

  return Response.json(result.rows[0], { status: 201 });
}
