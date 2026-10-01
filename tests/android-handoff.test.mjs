import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { encode } from 'next-auth/jwt';
import { Auth } from '@auth/core';
import { createHandoff, challengeFor } from '../src/lib/android-handoff.mjs';
import { sessionCookie, sessionHeaders } from '../src/lib/session-cookie.mjs';

// Generated test-only session material; never load .env or connect to production.
const secret = randomBytes(32).toString('hex');
const verifier = randomBytes(32).toString('base64url');
let pool, handoff, dir, bin;
before(async () => {
  bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
  dir = await mkdtemp(join(tmpdir(), 'notizen-oauth-test-'));
  execFileSync(join(bin, 'initdb'), ['-D', join(dir, 'data'), '--auth-local=trust', '--auth-host=reject', '--no-locale'], { stdio: 'ignore' });
  execFileSync(join(bin, 'pg_ctl'), ['-D', join(dir, 'data'), '-l', join(dir, 'postgres.log'), '-o', `-k ${dir} -p 55441 -c listen_addresses=''`, 'start'], { stdio: 'ignore' });
  pool = new pg.Pool({ host: dir, port: 55441, database: 'postgres', user: userInfo().username });
  const migration = await readFile(new URL('../migrations/001-android-oauth.sql', import.meta.url), 'utf8');
  await pool.query(migration);
  await pool.query(migration); // Existing installations can safely rerun this additive migration.
  handoff = createHandoff(pool, secret);
});
after(async () => {
  await pool?.end();
  if (dir && bin) execFileSync(join(bin, 'pg_ctl'), ['-D', join(dir, 'data'), 'stop'], { stdio: 'ignore' });
});

async function credential(extra = {}, maxAge = 300) {
  return encode({ secret, salt: sessionCookie.name, maxAge, token: { id: 'example-user', sub: 'example-user', ...extra } });
}
function browserRequest(token, challenge = challengeFor(verifier)) {
  const cookies = token ? sessionHeaders(token, Date.now() + 300000).map(x => x.split(';')[0]).join('; ') : '';
  return new Request(`https://notizen.dev/api/android-callback?code_challenge=${challenge}`, { headers: { cookie: cookies } });
}
async function issue(token = null) {
  const response = await handoff.issue(browserRequest(token || await credential()));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const html = await response.text();
  assert.ok(html.includes('Open Notizen'));
  assert.ok(!html.includes(token || '__absent__'));
  const otc = /otc=([A-Za-z0-9_-]{43})/.exec(html)?.[1];
  assert.ok(otc);
  return otc;
}
function redeem(otc, v = verifier) {
  return handoff.exchange(new Request('https://notizen.dev/api/exchange', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otc, code_verifier: v }),
  }));
}

test('PKCE uses the RFC 7636 S256 vector', () => {
  assert.equal(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('issuance rejects missing, forged, expired sessions and malformed challenge', async () => {
  assert.equal((await handoff.issue(browserRequest(null))).status, 401);
  assert.equal((await handoff.issue(browserRequest('invalid'))).status, 401);
  assert.equal((await handoff.issue(browserRequest(await credential({}, -60)))).status, 401);
  assert.equal((await handoff.issue(browserRequest(await credential(), 'bad'))).status, 400);
});
test('wrong or missing verifier leaves code usable; success is single-use', async () => {
  const otc = await issue();
  assert.equal((await redeem(otc, undefined + '')).status, 400);
  assert.equal((await redeem(otc, 'z'.repeat(43))).status, 401);
  const response = await redeem(otc);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal((await redeem(otc)).status, 401);
});
test('two concurrent redemptions allow exactly one success', async () => {
  const otc = await issue();
  const responses = await Promise.all([redeem(otc), redeem(otc)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 401]);
});
test('server expiry prevents redemption', async () => {
  const otc = await issue();
  await pool.query('UPDATE android_oauth_handoffs SET expires_at = NOW() - INTERVAL \'1 second\' WHERE code_hash = $1', [challengeFor(otc)]);
  assert.equal((await redeem(otc)).status, 401);
});
test('chunked session survives native handoff and authenticates through Auth.js', async () => {
  const token = await credential({ name: 'Example', padding: 'x'.repeat(6000) });
  const response = await redeem(await issue(token));
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.length > 1);
  assert.ok(cookies.every(c => c.includes('HttpOnly') && c.includes('Secure') && c.includes('SameSite=Lax')));
  const expiry = new Date(cookies[0].match(/Expires=([^;]+)/)[1]).getTime();
  assert.ok(expiry <= Date.now() + 300000); // no new 30-day life
  const session = await Auth(new Request('https://notizen.dev/api/auth/session', { headers: {
    cookie: cookies.map(c => c.split(';')[0]).join('; '),
  } }), { secret, trustHost: true, basePath: '/api/auth', providers: [],
    cookies: { sessionToken: sessionCookie }, session: { strategy: 'jwt' } });
  assert.equal((await session.json()).user.name, 'Example');
});
test('bad/oversized JSON is rejected without database mutation', async () => {
  for (const body of ['null', '{', 'x'.repeat(2049)]) {
    const response = await handoff.exchange(new Request('https://notizen.dev/api/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }));
    assert.equal(response.status, 400);
  }
});
