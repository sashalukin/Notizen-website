import pool from '@/lib/db';
import crypto from 'crypto';

export async function POST(request) {
  const { code, code_verifier } = await request.json();

  if (!code) {
    return Response.json({ error: 'Code is required' }, { status: 400 });
  }

  // Atomically fetch and delete the code (one-time use)
  const result = await pool.query(
    "DELETE FROM android_auth_codes WHERE code = $1 AND created_at > NOW() - INTERVAL '60 seconds' RETURNING session_token, code_challenge",
    [code]
  );

  if (result.rows.length === 0) {
    return Response.json({ error: 'Invalid or expired code' }, { status: 401 });
  }

  const { session_token: sessionToken, code_challenge: codeChallenge } = result.rows[0];

  // Verify PKCE
  if (!code_verifier) {
    return Response.json({ error: 'code_verifier is required' }, { status: 400 });
  }
  const hash = crypto.createHash('sha256').update(code_verifier).digest('base64url');
  if (hash !== codeChallenge) {
    return Response.json({ error: 'Invalid code_verifier' }, { status: 401 });
  }

  // Return the session token as a cookie
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieName = isProduction
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';

  const cookieOptions = [
    `${cookieName}=${sessionToken}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    isProduction ? 'Secure' : '',
    `Max-Age=${30 * 24 * 60 * 60}`, // 30 days
  ].filter(Boolean).join('; ');

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookieOptions,
    },
  });
}
