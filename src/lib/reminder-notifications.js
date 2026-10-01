export const reminderTag = (userId, id, when) => `${userId}:${id}:${when}`;

// Capability detection, not user-agent sniffing. Permission/status requests get
// replies; SHOW_NOTIFICATION is deliberately fire-and-forget, with no retries.
export const hasNativeNotifications = () => typeof window !== 'undefined' &&
  typeof window.AndroidNotifications?.postMessage === 'function';
let connectedBridge;
const pending = new Map();
function nativeRequest(type) {
  const bridge = window.AndroidNotifications;
  if (connectedBridge !== bridge) {
    connectedBridge = bridge;
    bridge.onmessage = ({ data }) => {
      try {
        const reply = JSON.parse(data);
        pending.get(reply.requestId)?.(reply);
      } catch { /* Ignore malformed or unrelated messages. */ }
    };
  }
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Android notification settings are unavailable.'));
    }, type === 'REQUEST_PERMISSION' ? 60000 : 3000);
    pending.set(requestId, reply => {
      clearTimeout(timeout); pending.delete(requestId); resolve(reply);
    });
    try { bridge.postMessage(JSON.stringify({ version: 1, type, requestId })); }
    catch (error) { clearTimeout(timeout); pending.delete(requestId); reject(error); }
  });
}
export async function notificationState() {
  if (hasNativeNotifications()) return nativeRequest('GET_STATE');
  return { permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission, active: true };
}
export async function requestNotificationPermission() {
  if (hasNativeNotifications()) return (await nativeRequest('REQUEST_PERMISSION')).permission;
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.requestPermission();
}
export function clearNativeNotifications() {
  try {
    if (hasNativeNotifications()) window.AndroidNotifications.postMessage(JSON.stringify({ version: 1, type: 'CLEAR_NOTIFICATIONS' }));
  } catch { /* Cleanup must not interrupt logout or account switching. */ }
}

export async function showReminderNotification({ body, tag, id }) {
  if (hasNativeNotifications()) {
    window.AndroidNotifications.postMessage(JSON.stringify({
      version: 1, type: 'SHOW_NOTIFICATION', notificationId: tag,
      title: 'Notizen reminder', body, noteId: id,
    }));
    return;
  }
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
    if (hasNativeNotifications()) {
      window.AndroidNotifications.postMessage(JSON.stringify({ version: 1, type: 'CLOSE_NOTIFICATION', notificationId: tag }));
      return;
    }
    const registration = await navigator.serviceWorker?.getRegistration('/');
    const notifications = await registration?.getNotifications({ tag });
    notifications?.forEach(notification => notification.close());
  } catch { /* Notification cleanup must not affect saving. */ }
}
