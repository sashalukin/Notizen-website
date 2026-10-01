// One configuration shared by Auth.js and the native handoff.
export const appOrigin = new URL(process.env.AUTH_URL || 'https://notizen.dev').origin;
export const sessionCookie = {
  name: `${appOrigin.startsWith('https:') ? '__Secure-' : ''}authjs.session-token`,
  options: { httpOnly: true, sameSite: 'lax', path: '/', secure: appOrigin.startsWith('https:') },
};

// Auth.js accepts numbered chunks. Keep each serialized cookie below 4 KiB.
export function sessionHeaders(token, expires) {
  const chunks = token.match(/.{1,3800}/g) || [];
  return chunks.map((value, index) => {
    const name = chunks.length === 1 ? sessionCookie.name : `${sessionCookie.name}.${index}`;
    return `${name}=${encodeURIComponent(value)}; Path=${sessionCookie.options.path}; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${sessionCookie.options.secure ? '; Secure' : ''}`;
  });
}
