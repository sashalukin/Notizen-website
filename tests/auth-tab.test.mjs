import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Auth, customFetch } from '@auth/core';
import Google from '@auth/core/providers/google';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { existsSync } from 'node:fs';

// Exercise the installed Auth.js Google provider, real CSRF and PKCE cookies,
// and real JWT session creation. Only Google's external service is simulated.
// No live account, database, provider credentials, or application OTC are used.
const origin = 'https://notizen.dev';
const callbackPath = '/api/auth/callback/google';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };

async function flow() {
  const jar = new Map();
  let challenge;
  let redeemed = false;
  const paths = [];
  const failures = [];
  const provider = Google({
    clientId: 'test-client', clientSecret: 'test-provider-secret',
    [customFetch]: async (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.includes('openid-configuration')) return Response.json({
        issuer: 'https://accounts.google.com',
        authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_endpoint: 'https://oauth2.googleapis.com/token',
        jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
        userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
        response_types_supported: ['code'], subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      });
      if (url.pathname === '/oauth2/v3/certs') return Response.json({ keys: [jwk] });
      if (url.href === 'https://oauth2.googleapis.com/token') {
        const params = new URLSearchParams(options.body);
        const verifier = params.get('code_verifier');
        const matches = verifier && createHash('sha256').update(verifier).digest('base64url') === challenge;
        if (redeemed || !matches || params.get('code') !== 'test-provider-code') {
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        }
        assert.equal(params.get('redirect_uri'), origin + callbackPath);
        redeemed = true;
        const idToken = await new SignJWT({ name: 'Test User', email: 'test@example.invalid', email_verified: true })
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer('https://accounts.google.com')
          .setAudience('test-client').setSubject('test-user').setIssuedAt().setExpirationTime('5m').sign(privateKey);
        return Response.json({ access_token: 'test-only-access', token_type: 'Bearer', expires_in: 300, id_token: idToken });
      }
      throw new Error('Unexpected provider request');
    },
  });
  const config = {
    secret: randomBytes(32).toString('hex'), trustHost: true, basePath: '/api/auth',
    providers: [provider], session: { strategy: 'jwt' },
    logger: { error: e => failures.push(e.type), warn() {}, debug() {} },
  };
  async function request(path, { method = 'GET', body, cookies = jar, save = true } = {}) {
    paths.push(new URL(path, origin).pathname);
    const headers = { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
    const response = await Auth(new Request(new URL(path, origin), { method, headers, body }), config);
    if (save) for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';', 1)[0], split = pair.indexOf('=');
      const name = pair.slice(0, split), value = pair.slice(split + 1);
      if (/max-age=0/i.test(line)) cookies.delete(name); else cookies.set(name, value);
    }
    return response;
  }
  const csrf = await (await request('/api/auth/csrf')).json();
  const signIn = await request('/api/auth/signin/google', {
    method: 'POST', body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl: origin + '/notes' }),
  });
  assert.equal(signIn.status, 302);
  const authorization = new URL(signIn.headers.get('location'));
  assert.equal(authorization.origin, 'https://accounts.google.com');
  assert.equal(authorization.searchParams.get('redirect_uri'), origin + callbackPath);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  challenge = authorization.searchParams.get('code_challenge');
  assert.ok(challenge);
  assert.ok([...jar.keys()].some(k => k.includes('pkce.code_verifier')));
  const returned = new URL(callbackPath, origin);
  returned.searchParams.set('code', 'test-provider-code');
  const state = authorization.searchParams.get('state');
  if (state) returned.searchParams.set('state', state);
  return { request, jar, returned, paths, failures };
}

test('Auth Tab return completed in original WebView establishes Auth.js session without handoff endpoints', async () => {
  const f = await flow();
  // Auth Tab returns the URL only. Its browser cookie jar is never copied.
  const response = await f.request(f.returned);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), origin + '/notes');
  assert.ok(response.headers.getSetCookie().some(c => c.startsWith('__Secure-authjs.session-token=')));
  const session = await (await f.request('/api/auth/session')).json();
  assert.equal(session.user?.email, 'test@example.invalid');
  assert.equal(f.failures.length, 0);
  assert.ok(f.paths.every(p => p.startsWith('/api/auth/')));
});

test('browser without original WebView cookies cannot finish the same callback', async () => {
  const f = await flow();
  const response = await f.request(f.returned, { cookies: new Map(), save: false });
  assert.ok(response.headers.get('location')?.includes('/api/auth/error'));
  assert.ok(f.failures.includes('InvalidCheck'));
  // This failed attempt never consumed the Google code; the correct cookie jar works.
  const correct = await f.request(f.returned);
  assert.equal(correct.headers.get('location'), origin + '/notes');
});

test('callback replay after PKCE cookie consumption fails', async () => {
  const f = await flow();
  await f.request(f.returned);
  const replay = await f.request(f.returned);
  assert.ok(replay.headers.get('location')?.includes('/api/auth/error'));
});

test('the three application handoff routes are absent from this branch', () => {
  for (const route of ['src/app/android-signin/page.js', 'src/app/api/android-callback/route.js', 'src/app/api/exchange/route.js']) {
    assert.equal(existsSync(route), false, route);
  }
});
