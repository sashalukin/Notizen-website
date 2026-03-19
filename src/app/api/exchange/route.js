import pool from '@/lib/db';

export async function POST(request) {
  const { code } = await request.json();

  if (!code) {
    return Response.json({ error: 'Code is required' }, { status: 400 });
  }

  // Look up the code (must be less than 60 seconds old)
  const result = await pool.query(
    "SELECT session_token FROM android_auth_codes WHERE code = $1 AND created_at > NOW() - INTERVAL '60 seconds'",
    [code]
  );

  if (result.rows.length === 0) {
    return Response.json({ error: 'Invalid or expired code' }, { status: 401 });
  }

  const sessionToken = result.rows[0].session_token;

  // Delete the code — one-time use only
  await pool.query('DELETE FROM android_auth_codes WHERE code = $1', [code]);

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
