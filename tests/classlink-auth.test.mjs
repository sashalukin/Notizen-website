import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Auth, customFetch } from '@auth/core';
import ClassLink from '../src/lib/auth-providers/classlink.js';

const origin = 'https://notizen.dev';
const id = 12345;
async function flow(callbackUrl = origin + '/notes', profile = { UserId: id, TenantId: 17, DisplayName: 'Test ClassLink User' }, tokenResponse = {}) {
  const jar = new Map();
  const failures = [];
  let exchanges = 0;
  let providerAccountId;
  let accountIdToken;
  let profileRequests = 0;
  const fetcher = async (input, options) => {
    const url = new URL(String(input));
    if (url.href === 'https://launchpad.classlink.com/oauth2/v2/token') {
      assert.equal(options.method, 'POST');
      assert.equal(new Headers(options.headers).get('authorization'), null);
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('client_id'), 'test-client');
      assert.equal(body.get('client_secret'), 'test-secret');
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('redirect_uri'), origin + '/api/auth/callback/classlink');
      assert.equal(body.get('code_verifier'), null);
      if (exchanges++) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({ access_token: 'synthetic-classlink-token', token_type: 'Bearer', ...tokenResponse });
    }
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic-classlink-token');
    if (url.href === 'https://nodeapi.classlink.com/v2/my/info') {
      profileRequests++;
      return profile instanceof Response ? profile : Response.json(profile);
    }
    throw new Error('Unexpected provider request');
  };
  const config = {
    secret: randomBytes(32).toString('hex'), trustHost: true, basePath: '/api/auth',
    providers: [ClassLink({ clientId: 'test-client', clientSecret: 'test-secret', [customFetch]: fetcher })],
    session: { strategy: 'jwt' },
    callbacks: {
      jwt: ({ token, user, account }) => { if (user) token.id = user.id; if (account) { providerAccountId = account.providerAccountId; accountIdToken = account.id_token; } return token; },
      session: ({ session, token }) => { session.user.id = token.id; return session; },
    },
    logger: { error: e => failures.push(e.type), warn() {}, debug() {} },
  };
  async function request(path, { method = 'GET', body, cookies = jar } = {}) {
    const headers = { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
    const res = await Auth(new Request(new URL(path, origin), { method, headers, body }), config);
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(';', 1)[0], split = pair.indexOf('=');
      if (/max-age=0/i.test(line)) cookies.delete(pair.slice(0, split));
      else cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return res;
  }
  const csrf = await (await request('/api/auth/csrf')).json();
  const start = await request('/api/auth/signin/classlink', {
    method: 'POST', body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl }),
  });
  const authorization = new URL(start.headers.get('location'));
  assert.equal(authorization.origin + authorization.pathname, 'https://launchpad.classlink.com/oauth2/v2/auth');
  assert.equal(authorization.searchParams.get('code_challenge'), null);
  assert.equal(authorization.searchParams.get('scope'), 'profile');
  assert.ok(authorization.searchParams.get('state'));
  const callback = new URL('/api/auth/callback/classlink', origin);
  callback.searchParams.set('code', 'synthetic-classlink-code');
  callback.searchParams.set('state', authorization.searchParams.get('state'));
  return { request, callback, failures, providerAccountId: () => providerAccountId, accountIdToken: () => accountIdToken, profileRequests: () => profileRequests, exchanges: () => exchanges };
}

// Synthetic ID token with claims deliberately different from the profile API.
// OAuth mode must not use or persist this optional OIDC token as identity.
function unsolicitedIdToken() {
  const now = Math.floor(Date.now() / 1000);
  return [
    { alg: 'RS256', typ: 'JWT' },
    { iss: 'https://issuer.example.invalid', aud: 'test-client', sub: 'different-user', name: 'Wrong identity', iat: now, exp: now + 300 },
  ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.c3ludGhldGlj';
}

test('ClassLink optional ID token does not trigger OIDC or override the profile API identity', async () => {
  const destination = origin + '/api/android-callback?code_challenge=' + 'b'.repeat(43);
  const f = await flow(destination, undefined, { id_token: unsolicitedIdToken() });
  const res = await f.request(f.callback);
  assert.equal(res.headers.get('location'), destination);
  assert.equal(f.profileRequests(), 1);
  assert.equal(f.providerAccountId(), '17:12345');
  assert.equal(f.accountIdToken(), undefined);
  const session = await (await f.request('/api/auth/session')).json();
  assert.equal(session.user.name, 'Test ClassLink User');
  assert.deepEqual(f.failures, []);
});

test('ClassLink optional ID token cannot substitute for a valid access token', async () => {
  const f = await flow(undefined, undefined, { access_token: '', id_token: unsolicitedIdToken() });
  const res = await f.request(f.callback);
  assert.ok(res.headers.get('location').includes('/api/auth/error'));
  assert.equal(f.profileRequests(), 0);
  assert.ok(!res.headers.getSetCookie().some(c => c.startsWith('__Secure-authjs.session-token=')));
});

test('ClassLink optional ID token cannot authenticate when the profile API denies access', async () => {
  const f = await flow(undefined, Response.json({ error: 'unauthorized' }, { status: 401 }), { id_token: unsolicitedIdToken() });
  const res = await f.request(f.callback);
  assert.ok(res.headers.get('location').includes('/api/auth/error'));
  assert.equal(f.profileRequests(), 1);
  assert.ok(!res.headers.getSetCookie().some(c => c.startsWith('__Secure-authjs.session-token=')));
});

test('ClassLink state-based flow creates a persistent session without requiring email', async () => {
  const f = await flow();
  const res = await f.request(f.callback);
  assert.equal(res.headers.get('location'), origin + '/notes');
  assert.ok(res.headers.getSetCookie().some(c => c.startsWith('__Secure-authjs.session-token=') && /Expires=/i.test(c)));
  const session = await (await f.request('/api/auth/session')).json();
  assert.equal(session.user.name, 'Test ClassLink User');
  assert.ok(session.user.id);
  assert.equal(f.providerAccountId(), '17:12345');
  assert.equal(session.user.email ?? null, null);
  assert.deepEqual(f.failures, []);
});

test('missing original state cookie rejects callback before token exchange', async () => {
  const f = await flow();
  const res = await f.request(f.callback, { cookies: new Map() });
  assert.ok(res.headers.get('location').includes('/api/auth/error'));
  assert.equal(f.exchanges(), 0);
});

test('wrong state rejects callback before token exchange', async () => {
  const f = await flow();
  f.callback.searchParams.set('state', 'wrong-state');
  await f.request(f.callback);
  assert.equal(f.exchanges(), 0);
  assert.ok(f.failures.length > 0);
});

test('ClassLink callback cannot be replayed', async () => {
  const f = await flow();
  await f.request(f.callback);
  const replay = await f.request(f.callback);
  assert.ok(replay.headers.get('location').includes('/api/auth/error'));
  assert.equal(f.exchanges(), 1);
});

test('ClassLink cancellation does not redeem a code or create a session', async () => {
  const f = await flow();
  f.callback.searchParams.delete('code');
  f.callback.searchParams.set('error', 'access_denied');
  const res = await f.request(f.callback);
  assert.equal(f.exchanges(), 0);
  assert.ok(!res.headers.getSetCookie().some(c => c.startsWith('__Secure-authjs.session-token=')));
});


test('ClassLink browser login preserves the Custom Tab handoff destination', async () => {
  const destination = origin + '/api/android-callback?code_challenge=' + 'a'.repeat(43);
  const f = await flow(destination);
  const response = await f.request(f.callback);
  assert.equal(response.headers.get('location'), destination);
  assert.ok(response.headers.getSetCookie().some(c => c.startsWith('__Secure-authjs.session-token=')));
});

test('ClassLink rejects missing or malformed district/user identity', async () => {
  for (const profile of [{UserId: 12345}, {TenantId: 17}, {UserId: {}, TenantId: 17}, {UserId: 1.5, TenantId: 17}]) {
    const f = await flow(undefined, profile);
    const response = await f.request(f.callback);
    assert.notEqual(response.headers.get('location'), origin + '/notes');
    assert.ok(f.failures.includes('OAuthProfileParseError'));
    assert.ok(!response.headers.getSetCookie().some(c => c.startsWith('__Secure-authjs.session-token=')));
  }
});

test('ClassLink account IDs are separated by district and do not depend on email', () => {
  const provider = ClassLink();
  const a = provider.profile({ UserId: 12345, TenantId: 17, Email: 'same@example.invalid' });
  const b = provider.profile({ UserId: 12345, TenantId: 18, Email: 'same@example.invalid' });
  assert.notEqual(a.id, b.id);
  assert.equal(provider.allowDangerousEmailAccountLinking, undefined);
});
