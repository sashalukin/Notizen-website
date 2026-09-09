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

  // Get the PKCE code_challenge (passed through from /android-signin)
  const codeChallenge = new URL(request.url).searchParams.get('code_challenge');
  if (!codeChallenge) {
    return Response.json({ error: 'code_challenge is required' }, { status: 400 });
  }

  // Generate a one-time code
  const code = crypto.randomUUID();

  // Store it with the code_challenge
  await pool.query(
    'INSERT INTO android_auth_codes (code, session_token, code_challenge) VALUES ($1, $2, $3)',
    [code, sessionToken, codeChallenge]
  );

  // Clean up codes older than 5 minutes
  await pool.query(
    "DELETE FROM android_auth_codes WHERE created_at < NOW() - INTERVAL '5 minutes'"
  );

  // Redirect to the Android app via explicit intent (package-targeted)
  return Response.redirect(`intent://auth?code=${code}#Intent;scheme=notizen;package=com.google.android.samples.notizen;end`);
}
