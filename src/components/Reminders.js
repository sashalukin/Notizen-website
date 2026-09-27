'use client';

import { useEffect, useRef } from 'react';
import * as store from '@/lib/offline/store';
import { reminderTag, showReminderNotification } from '@/lib/reminder-notifications';

export default function Reminders({ notes, userId, onSave, onError }) {
  const current = useRef({ notes, onSave, onError });
  current.current = { notes, onSave, onError };

  useEffect(() => {
    let alive = true, running = false;
    const retryAt = new Map(), accepted = new Set();
    async function deliver(note) {
      const key = reminderTag(userId, note.id, note.remind_at);
      if ((retryAt.get(key) || 0) > Date.now()) return;
      const report = message => { if (alive) current.current.onError(note, message); };
      try {
        // A second tab may already have reset or rescheduled this reminder.
        const latest = (await store.readNotes(userId)).find(n => n.id === note.id);
        if (!alive || latest?.deleted_at || latest?.remind_at !== note.remind_at) return;
        const db = await store.database();
        const receiptKey = ['reminder-delivery', userId, note.id];
        const receipt = await db.get('meta', receiptKey);
        if (receipt === note.remind_at) accepted.add(key);
        if (receipt !== note.remind_at && !accepted.has(key)) {
          if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
          await showReminderNotification({ body: latest.title || 'Untitled', tag: key, id: note.id });
          accepted.add(key);
        }
        if (!alive) return;
        // Persist acceptance before resetting so a failed local write/reload cannot resend it.
        await db.put('meta', note.remind_at, receiptKey);
        if (!alive) return;
        await current.current.onSave(note.id, { remind_at: null }, false, note.remind_at);
        report('');
        retryAt.delete(key);
        // Do NOT close the notification here: it must stay available after the bell resets.
      } catch (error) {
        retryAt.set(key, Date.now() + 30000);
        report(accepted.has(key)
          ? 'Notification sent, but resetting the reminder failed. Retrying.'
          : 'Notification could not be shown. Check notification settings or try again.');
      }
    }
    async function check() {
      if (!alive || running) return;
      running = true;
      try {
        for (const note of current.current.notes) {
          if (!alive || !note.remind_at || Date.parse(note.remind_at) > Date.now()) continue;
          const key = reminderTag(userId, note.id, note.remind_at);
          if ((retryAt.get(key) || 0) > Date.now()) continue;
          // Serialize delivery across tabs when Web Locks is available. The stable
          // notification tag and persisted receipt are the fallback safeguards.
          try {
            if (navigator.locks) {
              await navigator.locks.request(`notizen-reminder:${key}`, { ifAvailable: true }, lock => lock && deliver(note));
            } else await deliver(note);
          } catch {
            retryAt.set(key, Date.now() + 30000);
            if (alive) current.current.onError(note, 'Could not check this reminder. Try again.');
          }
        }
      } finally { running = false; }
    }
    const retry = () => { retryAt.clear(); check(); };
    check();
    const interval = setInterval(check, 1000);
    window.addEventListener('focus', retry);
    window.addEventListener('notizen-resume', retry);
    window.addEventListener('notizen-retry-reminders', retry);
    document.addEventListener('visibilitychange', check);
    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener('focus', retry);
      window.removeEventListener('notizen-resume', retry);
      window.removeEventListener('notizen-retry-reminders', retry);
      document.removeEventListener('visibilitychange', check);
    };
  }, [userId]);

  return null;
}
