import pool from '@/lib/db';
import { createHandoff } from '@/lib/android-handoff.mjs';
export async function GET(request) {
  return createHandoff(pool, process.env.AUTH_SECRET).issue(request);
}
