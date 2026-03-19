'use client';

import { useEffect } from 'react';
import { signIn } from 'next-auth/react';

export default function AndroidSignIn() {
  useEffect(() => {
    signIn('google', { callbackUrl: '/api/android-callback' });
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
