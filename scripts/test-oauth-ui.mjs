// Run against a local production build: node scripts/test-oauth-ui.mjs http://127.0.0.1:3415
// Provider traffic is mocked; this verifies routing, not a real Google sign-in.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.argv[2] || 'http://127.0.0.1:3415';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local test server only');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const requests = [];
  await context.route('**/api/auth/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/providers') return route.fulfill({ json: { google: { id: 'google', name: 'Google', type: 'oauth', signinUrl: `${base}/api/auth/signin/google` } } });
    if (path === '/api/auth/csrf') return route.fulfill({ json: { csrfToken: 'local-test-csrf' } });
    if (path === '/api/auth/signin/google') {
      requests.push(new URLSearchParams(route.request().postData()));
      return route.fulfill({ json: { url: `${base}/signin?test=done` } });
    }
    return route.fulfill({ json: null });
  });
  const page = await context.newPage();
  await page.goto(`${base}/signin`);
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await page.waitForURL('**/signin?test=done');
  assert.equal(new URL(requests.pop().get('callbackUrl'), base).pathname, '/notes');

  await page.addInitScript(() => {
    window.__nativeCalls = [];
    window.NotizenAuth = { postMessage: data => window.__nativeCalls.push(JSON.parse(data)) };
  });
  await page.goto(`${base}/signin`);
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  assert.deepEqual(await page.evaluate(() => window.__nativeCalls), [{ type: 'SIGN_IN' }]);
  assert.equal(requests.length, 0);

  await page.goto(`${base}/android-signin?code_challenge=bad`);
  await page.getByText('Invalid sign-in request. Start again in the app.').waitFor();
  assert.equal(requests.length, 0);
  const challenge = 'a'.repeat(43);
  await page.goto(`${base}/android-signin?code_challenge=${challenge}`);
  await page.waitForURL('**/signin?test=done');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].get('callbackUrl'), `/api/android-callback?code_challenge=${challenge}`);
  const unauth = await context.request.get(`${base}/api/android-callback?code_challenge=${challenge}`);
  assert.equal(unauth.status(), 401);
  assert.equal(unauth.headers()['cache-control'], 'no-store');
  assert.equal((await context.request.post(`${base}/api/exchange`, { data: {} })).status(), 400);
  console.log('Browser/native routing, challenge propagation, and HTTP rejection checks passed (provider mocked).');
} finally { await browser.close(); }
