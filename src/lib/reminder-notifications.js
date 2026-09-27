export const reminderTag = (userId, id, when) => `${userId}:${id}:${when}`;

export async function showReminderNotification({ title = 'Notizen reminder', body, tag, id }) {
  if (typeof Notification === 'undefined') throw new Error('System notifications are not supported in this browser or app.');
  if (Notification.permission !== 'granted') throw new Error('Allow notifications for Notizen in your browser settings.');
  const options = {
    body, tag, icon: '/android-chrome-192x192.png',
    data: { url: `/notes/${encodeURIComponent(id)}` },
    requireInteraction: true, silent: false,
  };
  const registration = await navigator.serviceWorker?.getRegistration('/');
  if (registration?.active && registration.showNotification) {
    let timer;
    try {
      await Promise.race([
        registration.showNotification(title, options),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The browser did not confirm the notification. Try again.')), 10000); }),
      ]);
    } finally { clearTimeout(timer); }
    return;
  }
  // Desktop fallback when the service worker has not activated yet.
  await new Promise((resolve, reject) => {
    const notification = new Notification(title, options);
    const timer = setTimeout(() => reject(new Error('The browser did not confirm the notification. Try again.')), 10000);
    notification.onshow = () => { clearTimeout(timer); resolve(); };
    notification.onerror = () => { clearTimeout(timer); reject(new Error('The browser could not show the notification.')); };
    notification.onclick = () => { window.focus(); window.location.assign(options.data.url); notification.close(); };
  });
}

export async function closeReminderNotification(tag) {
  try {
    const registration = await navigator.serviceWorker?.getRegistration('/');
    const notifications = await registration?.getNotifications({ tag });
    notifications?.forEach(notification => notification.close());
  } catch { /* Notification cleanup must not affect saving. */ }
}
