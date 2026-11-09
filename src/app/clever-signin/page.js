'use client';

import { useEffect, useState } from 'react';
import { getProviders, signIn } from 'next-auth/react';

export default function CleverSignInPage() {
  const [message, setMessage] = useState('Opening Clever sign-in…');
  useEffect(() => {
    let active = true;
    getProviders().then(providers => {
      if (!active) return;
      if (!providers?.clever) {
        setMessage('Clever sign-in is not available.');
        return;
      }
      // Portal entry is a browser login. Never accept a callback destination,
      // authorization code, district or native challenge from the incoming URL.
      return signIn('clever', { callbackUrl: '/notes' });
    }).catch(() => { if (active) setMessage('Could not start Clever sign-in. Please try again.'); });
    return () => { active = false; };
  }, []);
  return <main style={{ padding: '2rem', fontFamily: 'system-ui', textAlign: 'center' }}>
    <p>{message}</p>
    <a href="/signin">Back to sign-in</a>
  </main>;
}
