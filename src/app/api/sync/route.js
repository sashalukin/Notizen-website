import { auth } from '@/lib/auth';
import { notesStore } from '@/lib/server-notes';
import { validateOperation } from '@/lib/notes-store';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Sign in to sync' }, { status: 401, headers });
  const { id, name, email, image } = session.user;
  return Response.json({ user: { id, name, email, image }, notes: await notesStore.list(id, true) }, { headers });
}
export async function POST(request) {
  // Cookie-authenticated writes are same-origin only, including offline queue replay.
  const origin = request.headers.get('origin');
  const expected = new URL(process.env.NEXTAUTH_URL || request.url).origin;
  if (!origin || origin !== expected) return Response.json({ error: 'Invalid origin' }, { status: 403, headers });
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Sign in to sync' }, { status: 401, headers });
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2200000) return Response.json({ error: 'Batch too large' }, { status: 413, headers });
    body = JSON.parse(raw);
  } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers }); }
  if (body.accountId !== session.user.id) return Response.json({ error: 'Account changed' }, { status: 403, headers });
  if (!Array.isArray(body.operations) || body.operations.length > 20 || !body.operations.every(validateOperation)) {
    return Response.json({ error: 'Invalid operations' }, { status: 400, headers });
  }
  const results = [];
  for (const op of body.operations) results.push(await notesStore.apply(session.user.id, op));
  return Response.json({ results }, { headers });
}
