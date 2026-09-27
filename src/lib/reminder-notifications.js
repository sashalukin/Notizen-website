export const reminderTag = (userId, id, when) => `${userId}:${id}:${when}`;

export async function showReminderNotification({ body, tag, id }) {
  if (typeof Notification === 'undefined') throw new Error('System notifications are not supported in this browser or app.');
  if (Notification.permission !== 'granted') throw new Error('Allow notifications for Notizen in your browser settings.');
  const options = {
    body, tag, icon: '/android-chrome-192x192.png',
    data: { url: `/notes/${encodeURIComponent(id)}` },
    requireInteraction: true, silent: false,
  };
  if (!navigator.serviceWorker) throw new Error('This browser does not support reminder notifications.');
  // One delivery path. Bound the wait so a stalled browser cannot block other reminders.
  let timer, expired = false;
  try {
    await Promise.race([
      navigator.serviceWorker.ready.then(registration => {
        if (!expired) return registration.showNotification('Notizen reminder', options);
      }),
      new Promise((_, reject) => { timer = setTimeout(() => {
        expired = true;
        reject(new Error('The browser did not confirm the notification.'));
      }, 10000); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function closeReminderNotification(tag) {
  try {
    const registration = await navigator.serviceWorker?.getRegistration('/');
    const notifications = await registration?.getNotifications({ tag });
    notifications?.forEach(notification => notification.close());
  } catch { /* Notification cleanup must not affect saving. */ }
}
