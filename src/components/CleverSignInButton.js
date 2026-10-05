'use client';

import { useEffect, useState } from 'react';
import { getProviders, signIn } from 'next-auth/react';

export default function CleverSignInButton({ className }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    getProviders().then(providers => {
      if (active) setEnabled(Boolean(providers?.clever));
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  if (!enabled) return null;
  return <div style={{ marginTop: 12 }}>
    <button className={className} disabled={loading} onClick={async () => {
      setLoading(true);
      setError(false);
      try {
        await signIn('clever', { callbackUrl: '/notes' });
      } catch {
        setError(true);
        setLoading(false);
      }
    }}>{loading ? 'Opening Clever…' : 'Continue with Clever'}</button>
    {error && <p role="alert">Could not start sign-in. Please try again.</p>}
  </div>;
}
