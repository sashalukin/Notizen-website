import { randomBytes, createHash } from 'node:crypto';
import { getToken, decode } from 'next-auth/jwt';
import { sessionCookie, sessionHeaders } from './session-cookie.mjs';

export const validChallenge = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const validVerifier = value => typeof value === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
export const challengeFor = verifier => createHash('sha256').update(verifier, 'ascii').digest('base64url');
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const error = (status, message) => Response.json({ error: message }, { status, headers });

export function createHandoff(pool, secret) {
  async function claimsFor(token) {
    try {
      const claims = await decode({ token, secret, salt: sessionCookie.name });
      return claims?.id && claims.exp > Date.now() / 1000 ? claims : null;
    } catch { return null; }
  }

  async function issue(request) {
    const params = new URL(request.url).searchParams;
    const challenge = params.get('code_challenge');
    if (params.getAll('code_challenge').length !== 1 || !validChallenge(challenge)) return error(400, 'Invalid challenge');
    // Cookie-only input: do not accidentally turn the cookie example into a bearer endpoint.
    const req = new Request(request.url, { headers: { cookie: request.headers.get('cookie') || '' } });
    const token = await getToken({ req, secret, cookieName: sessionCookie.name, raw: true });
    const claims = token && await claimsFor(token);
    if (!claims) return error(401, 'Sign in again');
    const otc = randomBytes(32).toString('base64url');
    await pool.query(`INSERT INTO android_oauth_handoffs (code_hash, code_challenge, session_token, expires_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '60 seconds')`, [challengeFor(otc), challenge, token]);
    await pool.query(`DELETE FROM android_oauth_handoffs WHERE code_hash IN
      (SELECT code_hash FROM android_oauth_handoffs WHERE expires_at <= NOW() LIMIT 100)`);
    const link = `intent://auth?otc=${encodeURIComponent(otc)}#Intent;scheme=notizen;package=com.google.android.samples.notizen;end`;
    // A user-tapped link works even when the browser blocks automatic external redirects.
    // All interpolated data is server-generated base64url, never arbitrary user HTML.
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Return to Notizen</title><body><h1>Signed in</h1><p>Return to the app to finish signing in.</p><a href="${link}">Open Notizen</a><p>This link expires in 60 seconds. If it expires, start sign-in again in the app.</p></body></html>`, {
      headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'" },
    });
  }

  async function exchange(request) {
    if (!request.headers.get('content-type')?.startsWith('application/json')) return error(400, 'Expected JSON');
    // Bound the body even for streamed requests with no Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return error(400, 'Missing body');
    let text = '', size = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2048) { await reader.cancel(); return error(400, 'Body too large'); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } catch { return error(400, 'Invalid body'); }
    let body;
    try { body = JSON.parse(text); } catch { return error(400, 'Invalid JSON'); }
    if (!validChallenge(body?.otc) || !validVerifier(body?.code_verifier)) return error(400, 'Invalid fields');
    const result = await pool.query(`DELETE FROM android_oauth_handoffs
      WHERE code_hash = $1 AND code_challenge = $2 AND expires_at > NOW()
      RETURNING session_token`, [challengeFor(body.otc), challengeFor(body.code_verifier)]);
    if (!result.rows.length) return error(401, 'Invalid or expired sign-in');
    const token = result.rows[0].session_token;
    const claims = await claimsFor(token);
    if (!claims) return error(401, 'Session expired');
    const response = Response.json({ ok: true }, { headers });
    for (const cookie of sessionHeaders(token, claims.exp * 1000)) response.headers.append('Set-Cookie', cookie);
    return response;
  }
  return { issue, exchange };
}
