import pool from '@/lib/db';
import { createHandoff } from '@/lib/android-handoff.mjs';
export async function POST(request) {
  return createHandoff(pool, process.env.AUTH_SECRET).exchange(request);
}
