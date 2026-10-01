'use client';
import { useEffect } from 'react';
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
      navigator.storage?.persist?.().catch(() => {});
    }
  }, []);
  return null;
}
