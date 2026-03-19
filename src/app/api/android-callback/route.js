import { auth } from '@/lib/auth';
import pool from '@/lib/db';
import crypto from 'crypto';

export async function GET(request) {
  // Read the session — the user just completed OAuth in the Custom Tab
  const session = await auth();
  if (!session?.user?.id) {
    return Response.redirect(new URL('/signin', request.url));
  }

  // Get the session token from the cookie
  const sessionToken =
    request.cookies.get('authjs.session-token')?.value ||
    request.cookies.get('__Secure-authjs.session-token')?.value;

  if (!sessionToken) {
    return Response.redirect(new URL('/signin', request.url));
  }

  // Generate a one-time code
  const code = crypto.randomUUID();

  // Store it (expires naturally — exchange endpoint checks created_at)
  await pool.query(
    'INSERT INTO android_auth_codes (code, session_token) VALUES ($1, $2)',
    [code, sessionToken]
  );

  // Clean up codes older than 5 minutes
  await pool.query(
    "DELETE FROM android_auth_codes WHERE created_at < NOW() - INTERVAL '5 minutes'"
  );

  // Redirect to the Android app via deep link
  return Response.redirect(`notizen://auth?code=${code}`);
}
