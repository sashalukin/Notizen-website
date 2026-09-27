'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { signOut } from 'next-auth/react';
import Sidebar from './Sidebar';
import NoteEditor from './NoteEditor';
import Reminders from './Reminders';
import * as store from '@/lib/offline/store';
import { synchronize } from '@/lib/offline/sync';
import styles from './NotesWorkspace.module.css';

const selectedPath = () => typeof window === 'undefined' ? null : window.location.pathname.match(/^\/notes\/([^/]+)$/)?.[1] || null;
export default function NotesWorkspace() {
  const [user, setUser] = useState(null), [notes, setNotes] = useState([]), [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true), [status, setStatus] = useState('connecting'), [message, setMessage] = useState('');
  const [backOnline, setBackOnline] = useState(false), [offlineReady, setOfflineReady] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState(false);
  const disconnected = useRef(false);
  const userRef = useRef(null), channelRef = useRef(null), running = useRef(false), alive = useRef(true), schedule = useRef(null), rerun = useRef(false);
  const requestSync = useRef(() => {});
  const refreshGeneration = useRef(0);
  const storageBlocked = useRef(false);
  const refresh = useCallback(async () => {
    if (!userRef.current || storageBlocked.current) return;
    const generation = ++refreshGeneration.current;
    const accountId = userRef.current.id;
    const data = await store.readNotes(accountId);
    if (alive.current && generation === refreshGeneration.current && userRef.current?.id === accountId) setNotes(data.sort((a,b) => b.updated_at.localeCompare(a.updated_at)));
  }, []);
  const broadcast = useCallback(() => channelRef.current?.postMessage('changed'), []);
  const acceptUser = useCallback(async next => {
    if (!alive.current) return;
    if (userRef.current?.id && userRef.current.id !== next.id) {
      setNotes([]);
      navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_IMAGES' });
    }
    userRef.current = next;
    setUser(next);
  }, []);
  const sync = useCallback(async () => {
    if (storageBlocked.current) return;
    if (running.current) { rerun.current = true; return; }
    if (!navigator.onLine) { setStatus('offline'); return; }
    running.current = true;
    setStatus('syncing');
    try {
      const result = await synchronize(acceptUser, refresh);
      if (alive.current) {
        setStatus(!navigator.onLine ? 'offline' : result.busy || result.pending ? 'pending' : 'synced');
        setMessage('');
        broadcast();
      }
    } catch (e) {
      if (alive.current) {
        setStatus(e.status === 0 ? 'offline' : e.status === 401 ? 'auth' : 'error');
        if (e.status !== 0 && e.status !== 401) setMessage(e.status ? 'Could not sync. Your local changes are safe.' : 'Device storage unavailable. Keep this page open and retry.');
      }
    } finally {
      running.current = false;
      if (alive.current) setLoading(false);
      if (rerun.current && alive.current) { rerun.current = false; requestSync.current(); }
    }
  }, [acceptUser, refresh, broadcast]);
  useEffect(() => {
    requestSync.current = () => {
      clearTimeout(schedule.current);
      schedule.current = setTimeout(sync, 700);
    };
  }, [sync]);
  useEffect(() => {
    alive.current = true;
    setSelected(selectedPath());
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('notizen-offline');
      channelRef.current = channel;
      channel.onmessage = async e => {
        if (e.data === 'logout') { window.location.assign('/'); return; }
        const current = await store.account();
        if (current) { await acceptUser(current); await refresh(); }
      };
    }
    (async () => {
      try {
        const local = await store.account();
        if (local) { await acceptUser(local); await refresh(); }
        if (!navigator.onLine) { setStatus('offline'); setLoading(false); }
        else await sync();
      } catch { setMessage('Device storage unavailable. Keep this page open and retry.'); setStatus('error'); setLoading(false); }
    })();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(() => { if (alive.current) setOfflineReady(true); });
    }
    const offline = () => { setStatus('offline'); setConnectionNotice(true); setBackOnline(false); };
    const online = () => {
      setBackOnline(true);
      setConnectionNotice(true);
      sync();
    };
    const resume = () => { if (document.visibilityState === 'visible') sync(); };
    const pop = () => setSelected(selectedPath());
    window.addEventListener('offline', offline); window.addEventListener('online', online);
    window.addEventListener('notizen-resume', resume); window.addEventListener('pageshow', resume); window.addEventListener('focus', resume);
    window.addEventListener('popstate', pop); document.addEventListener('visibilitychange', resume);
    const poll = setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 30000);
    return () => {
      alive.current = false;
      clearTimeout(schedule.current); clearInterval(poll);
      channelRef.current?.close(); channelRef.current = null;
      window.removeEventListener('offline', offline); window.removeEventListener('online', online);
      window.removeEventListener('notizen-resume', resume); window.removeEventListener('pageshow', resume); window.removeEventListener('focus', resume);
      window.removeEventListener('popstate', pop); document.removeEventListener('visibilitychange', resume);
    };
  }, [sync, acceptUser, refresh]);
  // Ordinary startup, autosave and polling stay silent. Only an outage opens the notice.
  useEffect(() => {
    if (status === 'offline') {
      disconnected.current = true;
      setConnectionNotice(true);
      setBackOnline(false);
    } else if (status === 'synced' && disconnected.current) {
      disconnected.current = false;
      setBackOnline(true);
    }
  }, [status]);
  useEffect(() => {
    if (!connectionNotice || status !== 'synced') return;
    const timer = setTimeout(() => {
      setConnectionNotice(false);
      setBackOnline(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [connectionNotice, status]);
  useEffect(() => {
    if (!navigator.onLine || !offlineReady) return;
    const timer = setTimeout(() => {
      const urls = [];
      for (const note of notes) {
        if (note.deleted_at) continue;
        const doc = new DOMParser().parseFromString(note.content || '', 'text/html');
        urls.push(...[...doc.querySelectorAll('img[src]')].map(img => img.getAttribute('src')));
      }
      navigator.serviceWorker?.controller?.postMessage({ type: 'CACHE_IMAGES', urls });
    }, 1500);
    return () => clearTimeout(timer);
  }, [notes, offlineReady]);
  function navigate(id) {
    if (storageBlocked.current) { setMessage('Save failed. Retry saving this note before leaving it.'); return; }
    // Local routing needs no RSC response for a UUID that only exists on this device.
    window.history.pushState(null, '', id ? `/notes/${id}` : '/notes');
    setSelected(id);
  }
  async function save(id, changes, create = false, expectedReminder) {
    if (!userRef.current) throw new Error('Sign in before creating notes.');
    setStatus(navigator.onLine ? 'pending' : 'offline');
    try {
      const note = await store.saveLocal(userRef.current.id, id, changes, create, expectedReminder);
      storageBlocked.current = false;
      setMessage('');
      await refresh(); broadcast();
      setStatus(navigator.onLine ? 'pending' : 'offline');
      requestSync.current();
      return note;
    } catch (e) {
      storageBlocked.current = true;
      setMessage('Could not save on this device. Keep this page open and retry.'); setStatus('error');
      throw e;
    }
  }
  async function create() {
    if (storageBlocked.current) return;
    try { const id = crypto.randomUUID(); await save(id, { title: 'Untitled', content: '' }, true); navigate(id); }
    catch { /* The persistent banner explains the storage failure. */ }
  }
  async function remove(id) {
    if (storageBlocked.current) return;
    try { await save(id, { deleted_at: new Date().toISOString() }); if (selected === id) navigate(null); }
    catch { /* Keep the note visible on a failed transaction. */ }
  }
  async function resolve(note, both) {
    if (!both && !confirm('Discard your local version and use the server version?')) return;
    try {
      const copyId = await store.resolveConflict(user.id, note.id, both);
      await refresh(); broadcast(); requestSync.current();
      if (copyId) navigate(copyId);
    } catch { setMessage('Could not resolve this conflict. Please retry.'); }
  }
  async function logout() {
    if (storageBlocked.current) { setMessage('Save failed. Retry saving this note before signing out.'); return; }
    if (!navigator.onLine) { setMessage('Connect to the internet before signing out.'); return; }
    if ((await store.pending(user.id)).length) { setMessage('Sync or resolve your pending changes before signing out.'); requestSync.current(); return; }
    try {
      await signOut({ redirect: false });
      await store.clearAccount(user.id);
      navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_IMAGES' });
      channelRef.current?.postMessage('logout');
      window.location.assign('/');
    } catch { setMessage('Could not sign out. Please retry.'); }
  }
  const conflicts = notes.filter(n => n.conflict);
  const visible = notes.filter(n => !n.deleted_at);
  const active = visible.find(n => n.id === selected);
  const label = status === 'offline' ? 'No internet' : status === 'syncing' ? 'Syncing' : status === 'synced' ? 'Synchronized' : status === 'auth' ? 'Sign in to sync' : status === 'error' ? 'Could not sync' : status === 'connecting' ? 'Connecting' : conflicts.length ? 'Conflict to review' : 'Waiting to sync';
  return <div className={styles.workspace} data-sync-state={status}>
    {connectionNotice && <div className={`${styles.status} ${status === 'offline' || status === 'error' || status === 'auth' ? styles.muted : styles.green}`} role="status" aria-live="polite" data-testid="sync-status">
      {backOnline && status !== 'offline' && <span>Back online <span aria-hidden="true">·</span> </span>}
      {status === 'syncing' ? <span className={styles.spinner} aria-hidden="true" /> : status === 'synced' ? <span aria-hidden="true">✓</span> : null}
      <span>{label}</span>
      {['error','pending'].includes(status) && <button onClick={sync}>Retry</button>}
      {status === 'auth' && <a href="/signin?callbackUrl=/notes">Sign in</a>}
      {!offlineReady && status === 'synced' && <span className={styles.preparing}> · Preparing offline access</span>}
    </div>}
    {!connectionNotice && user && status === 'auth' && <div className={styles.notice} role="alert">Sign in to sync. <a href="/signin?callbackUrl=/notes">Sign in</a></div>}
    {message && <div className={styles.notice} role="alert">{message} {status === 'error' && <button onClick={sync}>Retry</button>} <button onClick={() => setMessage('')} aria-label="Dismiss">×</button></div>}
    {!!conflicts.length && <div className={styles.notice}>{conflicts.map(n => <div key={n.id}>
      “{n.title || 'Untitled'}” changed on another device. Your version is safe.
      <button onClick={() => resolve(n, true)}>Keep both</button><button onClick={() => resolve(n, false)}>Use server version</button>
    </div>)}</div>}
    {user && <Reminders key={user.id} notes={visible} userId={user.id} onSave={save} onSelect={navigate} />}
    {user ? <div className={styles.body}>
      <Sidebar notes={visible} loading={loading} activeNoteId={selected} onSelect={navigate} onCreate={create} onDelete={remove} user={user} onSignOut={logout} />
      <main className={styles.main}>{active ? <NoteEditor key={active.id} note={active} onSave={save} offline={status === 'offline'} /> : <div className={styles.empty}>{loading ? 'Loading…' : selected ? 'This note is not available on this device.' : 'Select a note or create a new one'}</div>}</main>
    </div> : <div className={styles.empty}>{loading ? 'Loading…' : <>Sign in online once to make your notes available offline. <a href="/signin">Sign in</a></>}</div>}
  </div>;
}
