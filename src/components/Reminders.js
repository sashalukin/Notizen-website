'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './NotesWorkspace.module.css';

export default function Reminders({ notes, userId, onSave, onSelect }) {
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState('');
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
          // The persistent in-app reminder remains available even if OS delivery fails.
          delivered.current.add(key);
        } finally { inFlight.current.delete(key); }
      })();
    }
  }, [notes, now, userId, onSelect]);

  const due = notes.filter(n => n.remind_at && Date.parse(n.remind_at) <= now);
  async function dismiss(note) {
    try {
      await onSave(note.id, { remind_at: null }, false, note.remind_at);
      setError('');
      try {
        const registration = await navigator.serviceWorker?.getRegistration('/');
        const notifications = await registration?.getNotifications({ tag: `${userId}:${note.id}:${note.remind_at}` });
        notifications?.forEach(notification => notification.close());
      } catch { /* Dismissal was already saved; OS notification cleanup is best-effort. */ }
    } catch { setError('Could not dismiss reminder. Please retry.'); }
  }
  if (!due.length) return null;
  return <div className={styles.reminders} aria-label="Due reminders">
    {due.map(note => <div className={styles.notice} role="alert" key={`${note.id}:${note.remind_at}`}>
      Reminder: {note.title || 'Untitled'}
      <button onClick={() => onSelect(note.id)}>Open note</button>
      <button onClick={() => dismiss(note)}>Dismiss reminder</button>
    </div>)}
    {error && <div className={styles.notice} role="alert">{error}</div>}
  </div>;
}
