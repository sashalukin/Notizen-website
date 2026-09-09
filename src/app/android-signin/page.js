'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';

function AndroidSignInInner() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const codeChallenge = searchParams.get('code_challenge');
    const callbackUrl = codeChallenge
      ? `/api/android-callback?code_challenge=${encodeURIComponent(codeChallenge)}`
      : '/api/android-callback';
    signIn('google', { callbackUrl });
  }, []);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      color: '#8E8E93',
      fontFamily: '-apple-system, sans-serif',
    }}>
      Redirecting to Google...
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
    }}>Redirecting to Google...</div>}>
      <AndroidSignInInner />
    </Suspense>
  );
}
