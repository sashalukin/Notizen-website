import { auth } from '@/lib/auth';
import pool from '@/lib/db';
import crypto from 'crypto';
import { notesStore } from '@/lib/server-notes';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return Response.json(await notesStore.list(session.user.id), { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await notesStore.ready();
  const id = crypto.randomUUID();
  const result = await pool.query(
    'INSERT INTO notes (id, user_id) VALUES ($1, $2) RETURNING id, title, content, created_at, updated_at',
    [id, session.user.id]
  );

  return Response.json(result.rows[0], { status: 201 });
}
