import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Auth, customFetch } from '@auth/core';
import Discord from '../src/lib/auth-providers/discord.js';

const origin = 'https://notizen.dev';
const id = '1556796058204508232';
async function flow() {
  const jar = new Map();
  const failures = [];
  let exchanges = 0;
  const fetcher = async (input, options) => {
    const url = new URL(String(input));
    if (url.href === 'https://discord.com/api/oauth2/token') {
      assert.equal(options.method, 'POST');
      assert.equal(new Headers(options.headers).get('authorization'), 'Basic ' + Buffer.from('test-client:test-secret').toString('base64'));
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('redirect_uri'), origin + '/api/auth/callback/discord');
      assert.equal(body.get('code_verifier'), null);
      if (exchanges++) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({ access_token: 'synthetic-discord-token', token_type: 'Bearer' });
    }
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic-discord-token');
    if (url.href === 'https://discord.com/api/users/@me') return Response.json({
      id, username: 'test-user', global_name: 'Test Discord User', avatar: null, discriminator: '0',
    });
    throw new Error('Unexpected provider request');
  };
  const config = {
    secret: randomBytes(32).toString('hex'), trustHost: true, basePath: '/api/auth',
    providers: [Discord({ clientId: 'test-client', clientSecret: 'test-secret', [customFetch]: fetcher })],
    session: { strategy: 'jwt' },
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
  const start = await request('/api/auth/signin/discord', {
    method: 'POST', body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl: origin + '/notes' }),
  });
  const authorization = new URL(start.headers.get('location'));
  assert.equal(authorization.origin + authorization.pathname, 'https://discord.com/api/oauth2/authorize');
  assert.equal(authorization.searchParams.get('code_challenge'), null);
  assert.equal(authorization.searchParams.get('scope'), 'identify');
  assert.ok(authorization.searchParams.get('state'));
  const callback = new URL('/api/auth/callback/discord', origin);
  callback.searchParams.set('code', 'synthetic-discord-code');
  callback.searchParams.set('state', authorization.searchParams.get('state'));
  return { request, callback, failures, exchanges: () => exchanges };
}

test('Discord state-based flow creates a persistent session without requiring email', async () => {
  const f = await flow();
  const res = await f.request(f.callback);
  assert.equal(res.headers.get('location'), origin + '/notes');
  assert.ok(res.headers.getSetCookie().some(c => c.startsWith('__Secure-authjs.session-token=') && /Expires=/i.test(c)));
  const session = await (await f.request('/api/auth/session')).json();
  assert.equal(session.user.name, 'Test Discord User');
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

test('Discord callback cannot be replayed', async () => {
  const f = await flow();
  await f.request(f.callback);
  const replay = await f.request(f.callback);
  assert.ok(replay.headers.get('location').includes('/api/auth/error'));
  assert.equal(f.exchanges(), 1);
});

test('Discord cancellation does not redeem a code or create a session', async () => {
  const f = await flow();
  f.callback.searchParams.delete('code');
  f.callback.searchParams.set('error', 'access_denied');
  const res = await f.request(f.callback);
  assert.equal(f.exchanges(), 0);
  assert.ok(!res.headers.getSetCookie().some(c => c.startsWith('__Secure-authjs.session-token=')));
});
