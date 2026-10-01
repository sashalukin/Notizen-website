'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';

function Start() {
  const params = useSearchParams();
  const started = useRef(false);
  const [error, setError] = useState('');
  const challenge = params.get('code_challenge');
  const valid = params.getAll('code_challenge').length === 1 && /^[A-Za-z0-9_-]{43}$/.test(challenge || '');
  useEffect(() => {
    if (!valid || started.current) return;
    started.current = true;
    signIn('google', { redirectTo: `/api/android-callback?code_challenge=${encodeURIComponent(challenge)}` })
      .catch(() => setError('Could not start sign-in. Return to the app and try again.'));
  }, [challenge, valid]);
  return <main>{!valid ? 'Invalid sign-in request. Start again in the app.' : error || 'Opening Google sign-in…'}</main>;
}

export default function AndroidSignIn() {
  return <Suspense fallback={<p>Starting sign-in…</p>}><Start /></Suspense>;
}
