import { auth } from '@/lib/auth';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';

// Development fallback. Production media is served directly by Cloud Storage.
const types = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac', aac: 'audio/aac' };
export async function GET(request, { params }) {
  if (process.env.GCS_BUCKET_NAME) return new Response(null, { status: 404 });
  if (!(await auth())?.user?.id) return new Response(null, { status: 401 });
  const { filename } = await params;
  const match = /^([0-9a-f-]{36})\.(mp3|m4a|wav|ogg|webm|flac|aac)$/.exec(filename);
  if (!match) return new Response(null, { status: 404 });
  const file = path.join(process.cwd(), 'public', 'uploads', filename);
  let size;
  try { size = (await stat(file)).size; } catch { return new Response(null, { status: 404 }); }
  const headers = { 'Content-Type': types[match[2]], 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  let start = 0, end = size - 1;
  const range = request.headers.get('range');
  if (range) {
    const parts = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!parts || (!parts[1] && !parts[2])) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    if (parts[1]) { start = Number(parts[1]); if (parts[2]) end = Math.min(Number(parts[2]), end); }
    else start = Math.max(0, size - Number(parts[2]));
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  return new Response(Readable.toWeb(createReadStream(file, { start, end })), { status: range ? 206 : 200, headers });
}
