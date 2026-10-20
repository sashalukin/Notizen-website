import { randomUUID, createHash } from 'node:crypto';
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
    // Only the browser's authenticated session can issue a native handoff.
    const req = new Request(request.url, { headers: { cookie: request.headers.get('cookie') || '' } });
    const token = await getToken({ req, secret, cookieName: sessionCookie.name, raw: true });
    const claims = token && await claimsFor(token);
    if (!claims) return error(401, 'Sign in again');
    const otc = randomUUID();
    await pool.query(`INSERT INTO android_auth_codes (code, code_challenge, session_token)
      VALUES ($1, $2, $3)`, [otc, challenge, token]);
    await pool.query(`DELETE FROM android_auth_codes WHERE code IN
      (SELECT code FROM android_auth_codes WHERE created_at <= NOW() - INTERVAL '60 seconds' LIMIT 100)`);
    const link = `intent://auth?code=${encodeURIComponent(otc)}#Intent;scheme=notizen;package=com.google.android.samples.notizen;end`;
    // User-gesture fallback also works when Chrome blocks an automatic external redirect.
    const nonce = randomUUID();
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Return to Notizen</title><body><h1>Signed in</h1><p>Return to the app to finish signing in.</p><a href="${link}">Open Notizen</a><p>If this link expires, start sign-in again in the app.</p><script nonce="${nonce}">window.location.replace(${JSON.stringify(link)})</script></body></html>`, {
      headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'` },
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
    if (!(typeof body?.code === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.code)) || !validVerifier(body?.code_verifier)) return error(400, 'Invalid fields');
    const result = await pool.query(`DELETE FROM android_auth_codes
      WHERE code = $1 AND code_challenge = $2 AND created_at > NOW() - INTERVAL '60 seconds'
      RETURNING session_token`, [body.code, challengeFor(body.code_verifier)]);
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
