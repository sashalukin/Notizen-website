'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getProviders, signIn } from 'next-auth/react';

function AndroidSignInInner() {
  const searchParams = useSearchParams();

  const [message, setMessage] = useState('Opening sign-in…');

  useEffect(() => {
    let active = true;
    const provider = searchParams.get('provider') || 'google';
    if (!['google', 'clever'].includes(provider)) {
      setMessage('Unsupported sign-in provider.');
      return;
    }
    const codeChallenge = searchParams.get('code_challenge');
    const callbackUrl = codeChallenge
      ? `/api/android-callback?code_challenge=${encodeURIComponent(codeChallenge)}`
      : '/api/android-callback';
    getProviders().then(providers => {
      if (!active) return;
      if (!providers?.[provider]) {
        setMessage('This sign-in provider is not available yet.');
        return;
      }
      return signIn(provider, { callbackUrl });
    }).catch(() => { if (active) setMessage('Could not start sign-in. Please try again.'); });
    return () => { active = false; };
  }, [searchParams]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      color: '#8E8E93',
      fontFamily: '-apple-system, sans-serif',
    }}>
      {message}
    </div>
  );
}

export default function AndroidSignIn() {
  return (
    <Suspense fallback={<div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      color: '#8E8E93',
      fontFamily: '-apple-system, sans-serif',
    }}>Opening sign-in…</div>}>
      <AndroidSignInInner />
    </Suspense>
  );
}
