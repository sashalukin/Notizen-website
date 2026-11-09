const restartCookie = '__Host-notizen-clever-restart';
const cookieOptions = 'Path=/; HttpOnly; Secure; SameSite=Lax';

// Clever portal / Instant Login callbacks have no app-generated state. Never
// exchange their code: restart an app-owned flow with fresh CSRF/state instead.
export function withCleverPortalRecovery(handler) {
  return async function GET(request, ...args) {
    const url = new URL(request.url);
    const cleverCallback = request.method === 'GET' && url.pathname === '/api/auth/callback/clever';
    if (cleverCallback && url.searchParams.has('code') &&
        !url.searchParams.has('state') && !url.searchParams.has('error')) {
      const restarted = (request.headers.get('cookie') || '').split(';')
        .some(cookie => cookie.trim() === `${restartCookie}=1`);
      // A provider that repeatedly omits state must not cause a redirect loop.
      return new Response(null, {
        status: 303,
        headers: {
          Location: restarted ? '/signin' : '/clever-signin',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'Set-Cookie': `${restartCookie}=1; Max-Age=120; ${cookieOptions}`,
        },
      });
    }
    const response = await handler(request, ...args);
    if (cleverCallback && url.searchParams.has('state')) {
      // Auth.js error redirects can have immutable headers.
      const headers = new Headers(response.headers);
      headers.append('Set-Cookie', `${restartCookie}=; Max-Age=0; ${cookieOptions}`);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return response;
  };
}
