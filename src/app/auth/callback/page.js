'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

function AuthCallback() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    if (!code) return;

    // Try intent-based handoff to the Android app
    window.location.href =
      `intent://auth/callback?code=${code}#Intent;scheme=https;host=notizen.dev;package=com.google.android.samples.notizen;end`;

    // If still here after 1.5s, show manual button
    const timer = setTimeout(() => setShowFallback(true), 1500);
    return () => clearTimeout(timer);
  }, [code]);

  if (!code) {
    return <p>Missing authorization code.</p>;
  }

  return (
    <div style={{ textAlign: 'center', paddingTop: '20vh', fontFamily: 'system-ui, sans-serif' }}>
      <p>Redirecting to Notizen...</p>
      {showFallback && (
        <a
          href={`intent://auth/callback?code=${code}#Intent;scheme=https;host=notizen.dev;package=com.google.android.samples.notizen;end`}
          style={{
            display: 'inline-block',
            marginTop: '24px',
            padding: '12px 24px',
            background: '#2563eb',
            color: '#fff',
            borderRadius: '8px',
            textDecoration: 'none',
            fontSize: '16px',
          }}
        >
          Open Notizen
        </a>
      )}
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<p style={{ textAlign: 'center', paddingTop: '20vh' }}>Redirecting...</p>}>
      <AuthCallback />
    </Suspense>
  );
}
