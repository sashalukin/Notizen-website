'use client';

import { useEffect, useRef, useState } from 'react';

export default function Reminders({ notes, userId, onSelect }) {
  const [now, setNow] = useState(() => Date.now());
  const delivered = useRef(new Set());
  const inFlight = useRef(new Set());
  const current = useRef(notes);
  current.current = notes;

  useEffect(() => {
    const check = () => setNow(Date.now());
    const interval = setInterval(check, 1000);
    window.addEventListener('focus', check);
    window.addEventListener('notizen-resume', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(interval);
      current.current = [];
      window.removeEventListener('focus', check);
      window.removeEventListener('notizen-resume', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    for (const note of notes) {
      if (!note.remind_at || Date.parse(note.remind_at) > now) continue;
      const key = `${userId}:${note.id}:${note.remind_at}`;
      if (delivered.current.has(key) || inFlight.current.has(key)) continue;
      inFlight.current.add(key);
      (async () => {
        try {
          const registration = await navigator.serviceWorker?.getRegistration('/');
          if (!current.current.some(n => n.id === note.id && n.remind_at === note.remind_at)) return;
          const options = { body: note.title || 'Untitled', icon: '/android-chrome-192x192.png',
            tag: key, data: { url: `/notes/${encodeURIComponent(note.id)}` } };
          // Mobile browsers require the service-worker API rather than the constructor.
          if (registration?.active && registration.showNotification) {
            await registration.showNotification('Notizen reminder', options);
          } else {
            const notification = new Notification('Notizen reminder', options);
            notification.onclick = () => { window.focus(); onSelect(note.id); notification.close(); };
          }
          delivered.current.add(key);
        } catch {
          // Keep the scheduled reminder intact if OS delivery fails.
          delivered.current.add(key);
        } finally { inFlight.current.delete(key); }
      })();
    }
  }, [notes, now, userId, onSelect]);

  // Canceling with the editor bell also closes any delivered system notification.
  useEffect(() => {
    (async () => {
      try {
        const registration = await navigator.serviceWorker?.getRegistration('/');
        const notifications = await registration?.getNotifications();
        const activeTags = new Set(current.current.filter(n => n.remind_at)
          .map(n => `${userId}:${n.id}:${n.remind_at}`));
        notifications?.forEach(notification => {
          if (notification.tag.startsWith(`${userId}:`) && !activeTags.has(notification.tag)) notification.close();
        });
      } catch { /* Notification cleanup must not affect note saving. */ }
    })();
  }, [notes, userId]);

  return null;
}
