import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Run against a local production build. Auth endpoints are mocked; no live credentials.
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3217';
const names = {google: 'Sign in with Google', discord: 'Continue with Discord', clever: 'Sign in with Clever', classlink: 'Sign in with ClassLink'};
const browser = await chromium.launch({ headless: true });
let checks = 0;
async function pageFor(native = false, schoolEnabled = true) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  if (native) await context.addInitScript(() => {
    window.signInMessages = [];
    window.NotizenAuth = { postMessage: text => window.signInMessages.push(JSON.parse(text)) };
  });
  const page = await context.newPage();
  const posts = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/auth/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/providers')) return route.fulfill({ json: Object.fromEntries(
      (schoolEnabled ? Object.keys(names) : ['google', 'discord']).map(id => [id, {
        id, name: id, type: 'oauth', signinUrl: `${base}/api/auth/signin/${id}`,
        callbackUrl: `${base}/api/auth/callback/${id}`,
      }]),
    ) });
    if (path.endsWith('/session')) return route.fulfill({ contentType: 'application/json', body: 'null' });
    if (path.endsWith('/csrf')) return route.fulfill({ json: { csrfToken: 'test-csrf' } });
    if (request.method() === 'POST' && path.includes('/signin/')) {
      posts.push({ provider: path.split('/').at(-1), body: new URLSearchParams(request.postData()) });
      return route.fulfill({ json: { url: `${base}/signin?test-complete=1` } });
    }
    return route.fulfill({ status: 400, json: {} });
  });
  return { context, page, posts, errors };
}
try {
  const portal = await pageFor();
  await portal.page.goto(`${base}/clever-signin?callbackUrl=https://attacker.example&code_challenge=untrusted`);
  await portal.page.waitForURL('**/signin?test-complete=1');
  assert.equal(portal.posts.length, 1);
  assert.equal(portal.posts[0].provider, 'clever');
  assert.equal(portal.posts[0].body.get('callbackUrl'), '/notes');
  assert.deepEqual(portal.errors, []);
  await portal.context.close();
  checks++;

  for (const path of ['/', '/signin']) {
    for (const provider of Object.keys(names)) {
      const { context, page, posts, errors } = await pageFor(true);
      await page.goto(base + path);
      await page.getByRole('button', { name: names[provider] }).click();
      await page.waitForFunction(() => window.signInMessages.length === 1);
      assert.deepEqual(await page.evaluate(() => window.signInMessages), [{ type: 'SIGN_IN', provider }]);
      assert.equal(posts.length, 0, 'native button must not start OAuth in WebView');
      assert.deepEqual(errors, []);
      await context.close();
      checks++;
    }
  }
  for (const provider of Object.keys(names)) {
    const { context, page, posts, errors } = await pageFor();
    await page.goto(base + '/signin');
    await page.getByRole('button', { name: names[provider] }).click();
    await page.waitForURL('**/signin?test-complete=1');
    assert.equal(posts[0].provider, provider);
    assert.equal(posts[0].body.get('callbackUrl'), '/notes');
    assert.deepEqual(errors, []);
    await context.close();
    checks++;

    const cct = await pageFor();
    const challenge = 'a'.repeat(43);
    await cct.page.goto(`${base}/android-signin?provider=${provider}&code_challenge=${challenge}`);
    await cct.page.waitForURL('**/signin?test-complete=1');
    assert.equal(cct.posts[0].provider, provider);
    assert.equal(cct.posts[0].body.get('callbackUrl'), `/api/android-callback?code_challenge=${challenge}`);
    assert.deepEqual(cct.errors, []);
    await cct.context.close();
    checks++;
  }
  for (const [query, message] of [
    ['provider=google', 'Invalid sign-in request.'],
    ['provider=other&code_challenge=' + 'a'.repeat(43), 'Unsupported sign-in provider.'],
    ['provider=clever&code_challenge=' + 'a'.repeat(43), 'This sign-in provider is not available yet.'],
    ['provider=classlink&code_challenge=' + 'a'.repeat(43), 'This sign-in provider is not available yet.'],
  ]) {
    const { context, page, posts } = await pageFor(false, false);
    await page.goto(`${base}/android-signin?${query}`);
    await page.getByText(message, { exact: false }).waitFor();
    assert.equal(posts.length, 0);
    await context.close();
    checks++;
  }
  for (const path of ['/', '/signin']) {
    const { context, page, posts } = await pageFor(true, false);
    await page.goto(base + path);
    await page.getByText('Not available yet').first().waitFor();
    for (const provider of ['clever', 'classlink']) {
      assert.ok(await page.getByRole('button', {name: names[provider]}).isDisabled());
    }
    assert.equal(posts.length, 0);
    await context.close();
    checks++;
  }
  console.log(`Passed ${checks} Custom Tab / normal browser sign-in UI checks.`);
} finally {
  await browser.close();
}
