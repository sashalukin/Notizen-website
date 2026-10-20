import { signIn } from 'next-auth/react';

// Only the app installs this origin-restricted bridge. Normal browsers retain web login.
export function startSignIn(provider) {
  if (typeof window !== 'undefined' && window.NotizenAuth?.postMessage) {
    window.NotizenAuth.postMessage(JSON.stringify({ type: 'SIGN_IN', provider }));
    return Promise.resolve();
  }
  return signIn(provider, { callbackUrl: '/notes' });
}
