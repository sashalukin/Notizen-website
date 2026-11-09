import test from 'node:test';
import assert from 'node:assert/strict';
import { withCleverPortalRecovery } from '../src/lib/clever-portal-recovery.mjs';

const origin = 'https://notizen.dev';
test('unsolicited Clever code is discarded and restart cannot accept attacker destinations', async () => {
  let handled = false;
  const get = withCleverPortalRecovery(() => { handled = true; });
  const response = await get(new Request(origin + '/api/auth/callback/clever?code=untrusted&callbackUrl=https://attacker.example&district_id=other&code_challenge=untrusted'));
  assert.equal(handled, false);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/clever-signin');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
});

test('a repeated stateless callback stops at the sign-in page instead of looping', async () => {
  const get = withCleverPortalRecovery(() => assert.fail('must not exchange an unsolicited code'));
  const response = await get(new Request(origin + '/api/auth/callback/clever?code=untrusted', {
    headers: { cookie: '__Host-notizen-clever-restart=1' },
  }));
  assert.equal(response.headers.get('location'), '/signin');
});

test('state-bearing callbacks, provider errors and other providers retain normal validation', async () => {
  for (const path of [
    '/api/auth/callback/clever?code=test&state=wrong',
    '/api/auth/callback/clever?code=test&state=',
    '/api/auth/callback/clever?error=access_denied',
    '/api/auth/callback/clever?code=test&error=access_denied',
    '/api/auth/callback/google?code=test',
    '/api/auth/callback/classlink?code=test',
  ]) {
    let received;
    const get = withCleverPortalRecovery(request => {
      received = request.url;
      return new Response(null, { status: 302, headers: { Location: '/validated-by-auth' } });
    });
    const response = await get(new Request(origin + path));
    assert.equal(received, origin + path);
    assert.equal(response.headers.get('location'), '/validated-by-auth');
  }
});
