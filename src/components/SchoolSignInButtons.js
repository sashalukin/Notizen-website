'use client';

import { useEffect, useState } from 'react';
import { getProviders } from 'next-auth/react';
import { startSignIn } from '../lib/start-sign-in';

const schools = [['clever', 'Clever'], ['classlink', 'ClassLink']];

export default function SchoolSignInButtons({ className }) {
  const [providers, setProviders] = useState(null);
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    getProviders().then(value => { if (active) setProviders(value || {}); })
      .catch(() => { if (active) setProviders({}); });
    return () => { active = false; };
  }, []);
  return <div>
    {schools.map(([id, name]) => {
      const enabled = Boolean(providers?.[id]);
      return <div key={id} style={{ marginTop: 12 }}>
        <button
          className={className}
          disabled={!enabled || loading !== null}
          style={!enabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
          aria-describedby={!enabled && providers ? `${id}-availability` : undefined}
          onClick={async () => {
            setLoading(id);
            setError(false);
            try { await startSignIn(id); }
            catch { setError(true); }
            finally { setLoading(null); }
          }}
        >{loading === id ? `Opening ${name}…` : `Sign in with ${name}`}</button>
        {!enabled && providers && <p id={`${id}-availability`} style={{ fontSize: 12, margin: '4px 0 0' }}>
          Not available yet
        </p>}
      </div>;
    })}
    {error && <p role="alert">Could not start sign-in. Please try again.</p>}
  </div>;
}
