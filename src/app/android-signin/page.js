'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getProviders, signIn, signOut } from 'next-auth/react';

function AndroidSignInInner() {
  const searchParams = useSearchParams();

  const [message, setMessage] = useState('Opening sign-in…');

  useEffect(() => {
    let active = true;
    const provider = searchParams.get('provider') || 'google';
    if (!['google', 'discord', 'clever', 'classlink'].includes(provider)) {
      setMessage('Unsupported sign-in provider.');
      return;
    }
    const codeChallenge = searchParams.get('code_challenge');
    if (!codeChallenge || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
      setMessage('Invalid sign-in request. Please start again in Notizen.');
      return;
    }
    const callbackUrl = codeChallenge
      ? `/api/android-callback?code_challenge=${encodeURIComponent(codeChallenge)}`
      : '/api/android-callback';
    getProviders().then(async providers => {
      if (!active) return;
      if (!providers?.[provider]) {
        setMessage('This sign-in provider is not available yet.');
        return;
      }
      // Custom Tabs share Chrome's Notizen session, not the WebView session.
      // Native sign-in selects an account; it must not implicitly link the chosen
      // provider to a different account left signed in by an earlier browser login.
      // Use Auth.js's CSRF-protected POST (including chunked-cookie cleanup), and
      // wait for it before creating the new OAuth state/callback cookies.
      const signedOut = await signOut({ redirect: false, callbackUrl: '/signin' });
      if (!active) return;
      const destination = new URL(signedOut?.url || '', window.location.origin);
      // Only inspect the result; never navigate to it. Preview hosts may receive
      // the configured canonical origin from Auth.js.
      if (destination.pathname !== '/signin' || destination.search) {
        throw new Error('Could not reset browser sign-in');
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
