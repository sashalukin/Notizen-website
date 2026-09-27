'use client';

import { useEffect, useRef } from 'react';
import * as store from '@/lib/offline/store';
import { reminderTag, showReminderNotification } from '@/lib/reminder-notifications';

export default function Reminders({ notes, userId, onSave, onError }) {
  const current = useRef({ notes, onSave, onError });
  current.current = { notes, onSave, onError };

  useEffect(() => {
    let alive = true, running = false;
    const attempted = new Set();
    async function deliver(note) {
      const key = reminderTag(userId, note.id, note.remind_at);
      const report = message => { if (alive) current.current.onError(note, message); };
      let accepted = false;
      try {
        // A second tab may already have reset or rescheduled this reminder.
        const latest = (await store.readNotes(userId)).find(n => n.id === note.id);
        if (!alive || latest?.deleted_at || latest?.remind_at !== note.remind_at) return;
        const db = await store.database();
        const receiptKey = ['reminder-delivery', userId, note.id];
        const receipt = await db.get('meta', receiptKey);
        accepted = receipt === note.remind_at;
        if (!accepted) {
          if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
          attempted.add(key);
          await showReminderNotification({ body: latest.title || 'Untitled', tag: key, id: note.id });
          accepted = true;
        }
        attempted.add(key);
        if (!alive) return;
        // Persist acceptance before resetting so a failed local write/reload cannot resend it.
        await db.put('meta', note.remind_at, receiptKey);
        if (!alive) return;
        await current.current.onSave(note.id, { remind_at: null }, false, note.remind_at);
        report('');
        // Do NOT close the notification here: it must stay available after the bell resets.
      } catch {
        attempted.add(key);
        report(accepted
          ? 'Notification sent, but the reminder could not be reset.'
          : 'Notification could not be shown. Check notification settings and set a new reminder.');
      }
    }
    async function check() {
      if (!alive || running) return;
      running = true;
      try {
        for (const note of current.current.notes) {
          if (!alive || !note.remind_at || Date.parse(note.remind_at) > Date.now()) continue;
          const key = reminderTag(userId, note.id, note.remind_at);
          if (attempted.has(key)) continue;
          // Serialize delivery across tabs when Web Locks is available. The stable
          // notification tag and persisted receipt are the fallback safeguards.
          try {
            if (navigator.locks) {
              await navigator.locks.request(`notizen-reminder:${key}`, { ifAvailable: true }, lock => lock && deliver(note));
            } else await deliver(note);
          } catch {
            attempted.add(key);
            if (alive) current.current.onError(note, 'Could not check this reminder. Set a new reminder.');
          }
        }
      } finally { running = false; }
    }
    check();
    const interval = setInterval(check, 1000);
    window.addEventListener('focus', check);
    window.addEventListener('notizen-resume', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener('focus', check);
      window.removeEventListener('notizen-resume', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [userId]);

  return null;
}
