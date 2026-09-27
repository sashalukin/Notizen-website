'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import styles from './NoteEditor.module.css';
import DOMPurify from 'dompurify';
import { reminderTag, closeReminderNotification, notificationState, requestNotificationPermission } from '@/lib/reminder-notifications';

export default function NoteEditor({ note, onSave, offline = false, reminderDeliveryError }) {
  const [title, setTitle] = useState(note.title || '');
  const [saveStatus, setSaveStatus] = useState('saved');
  const [displayedSaveStatus, setDisplayedSaveStatus] = useState('saved');
  const [remindAt, setRemindAt] = useState(note.remind_at || null);
  const [notificationPermission, setNotificationPermission] = useState('unsupported');
  const [reminderError, setReminderError] = useState('');
  const editorRef = useRef(null);
  const savingRef = useRef(0);
  const failedRef = useRef(false);
  const saveChain = useRef(Promise.resolve());
  const seenSeq = useRef(note.localSeq || 0);
  const draftRef = useRef(null);
  const fileInputRef = useRef(null);
  const reminderInputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const update = async () => {
      try { const state = await notificationState(); if (alive) setNotificationPermission(state.permission); }
      catch { if (alive) setNotificationPermission('unsupported'); }
    };
    update();
    window.addEventListener('focus', update);
    window.addEventListener('notizen-resume', update);
    return () => { alive = false; window.removeEventListener('focus', update); window.removeEventListener('notizen-resume', update); };
  }, []);

  async function enableNotifications() {
    try {
      setNotificationPermission(await requestNotificationPermission());
    }
    catch { setReminderError('System notifications are unavailable here.'); }
  }

  // Reminder completion must update the bell even while the note body is being edited.
  useEffect(() => { setRemindAt(note.remind_at || null); }, [note.remind_at]);

  // Keep fast local writes visually quiet without delaying persistence.
  // Slow saves still show progress; failures are never debounced.
  useEffect(() => {
    if (saveStatus !== 'saving') {
      setDisplayedSaveStatus(saveStatus);
      return;
    }
    const timer = setTimeout(() => setDisplayedSaveStatus('saving'), 500);
    return () => clearTimeout(timer);
  }, [saveStatus]);

  // Refresh remote changes without resetting the caret for our own local saves.
  useEffect(() => {
    if (failedRef.current || savingRef.current || (note.localSeq || 0) < seenSeq.current) return;
    seenSeq.current = note.localSeq || 0;
    setTitle(note.title || '');
    setRemindAt(note.remind_at || null);
    const safe = DOMPurify.sanitize(note.content || '', { FORBID_TAGS: ['style', 'iframe'], FORBID_ATTR: ['style'] });
    if (editorRef.current && editorRef.current.innerHTML !== safe) editorRef.current.innerHTML = safe;
  }, [note]);

  // Update browser tab title
  useEffect(() => {
    document.title = title || 'Untitled';
    return () => { document.title = 'Notizen'; };
  }, [title]);

  useEffect(() => {
    const protectDraft = e => {
      if (failedRef.current || savingRef.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, []);

  const save = useCallback(async (data) => {
    draftRef.current = { ...draftRef.current, ...data };
    savingRef.current++;
    setSaveStatus('saving');
    const commit = async () => {
      try {
        const persisted = await onSave(note.id, failedRef.current ? draftRef.current : data);
        seenSeq.current = Math.max(seenSeq.current, persisted.localSeq || 0);
        failedRef.current = false;
        return persisted;
      } catch { failedRef.current = true; }
      finally {
        savingRef.current--;
        if (!failedRef.current && !savingRef.current) draftRef.current = null;
        setSaveStatus(failedRef.current ? 'error' : savingRef.current ? 'saving' : 'saved');
      }
    };
    saveChain.current = saveChain.current.then(commit, commit);
    return await saveChain.current;
  }, [onSave, note.id]);

  // Persist immediately; only the network synchronization is debounced.
  const debouncedSave = save;

  function handleTitleChange(e) {
    const newTitle = e.target.value;
    setTitle(newTitle);
    debouncedSave({
      title: newTitle,
    });
  }

  function handleEditorInput() {
    debouncedSave({
      content: DOMPurify.sanitize(editorRef.current?.innerHTML || '', { FORBID_TAGS: ['style', 'iframe'], FORBID_ATTR: ['style'] }),
    });
  }

  function handleBold() {
    document.execCommand('bold');
    editorRef.current?.focus();
  }

  function handleImageClick() {
    if (!navigator.onLine) { alert('Connect to the internet to add images. Text edits are saved offline.'); return; }
    fileInputRef.current?.click();
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        // Insert image at cursor position
        editorRef.current?.focus();
        document.execCommand('insertHTML', false, `<img src="${data.url}" />`);
        handleEditorInput();
      }
    } catch (err) {
      console.error('Upload failed:', err);
    }

    // Reset file input
    e.target.value = '';
  }

  async function handleDownloadPdf() {
    const html2pdf = (await import('html2pdf.js')).default;
    const element = document.createElement('div');
    const heading = document.createElement('h1');
    heading.textContent = title || 'Untitled';
    element.append(heading);
    element.insertAdjacentHTML('beforeend', DOMPurify.sanitize(editorRef.current?.innerHTML || ''));
    element.style.fontFamily = '-apple-system, BlinkMacSystemFont, sans-serif';
    element.style.color = '#3C3C43';
    element.style.lineHeight = '1.7';
    const images = element.querySelectorAll('img');
    images.forEach(img => { img.style.maxWidth = '300px'; });

    html2pdf().set({
      margin: [16, 16, 16, 16],
      filename: `${title || 'Untitled'}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).from(element).save();
  }

  function handleBellClick() {
    if (remindAt) {
      if (confirm('Cancel reminder?')) {
        handleClearReminder();
      }
    } else {
      reminderInputRef.current?.showPicker();
    }
  }

  async function handleSetReminder(dateStr) {
    setRemindAt(dateStr);
    await save({ remind_at: dateStr });
  }

  async function handleClearReminder() {
    const previousTime = remindAt;
    setRemindAt(null);
    const persisted = await save({ remind_at: null });
    if (persisted?.remind_at === null) await closeReminderNotification(reminderTag(note.userId, note.id, previousTime));
  }

  function handleReminderChange(e) {
    if (e.target.value) {
      const date = new Date(e.target.value);
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
        setReminderError('Choose a future time for the reminder.');
      } else {
        setReminderError('');
        handleSetReminder(date.toISOString());
      }
    }
    e.target.value = '';
  }

  function handleKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      handleBold();
    }
  }

  function formatReminderTime(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  const statusText = {
    saved: 'Saved on device',
    saving: 'Saving...',
    unsaved: 'Editing',
    error: 'Save failed',
  };

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarButtons}>
          <button
            className={styles.toolbarButton}
            onClick={handleBold}
            title="Bold (Cmd+B)"
          >
            <strong>B</strong>
          </button>
          <button
            className={styles.toolbarButton}
            onClick={handleImageClick}
            title="Insert image"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </button>
          <button
            className={styles.toolbarButton}
            onClick={handleDownloadPdf}
            title="Download as PDF"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          <button
            className={`${styles.toolbarButton} ${remindAt ? styles.reminderActive : ''}`}
            onClick={handleBellClick}
            title={remindAt ? `Reminder: ${formatReminderTime(remindAt)}` : 'Set reminder'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={remindAt ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </button>
          <input
            ref={reminderInputRef}
            type="datetime-local"
            className={styles.reminderInput}
            onChange={handleReminderChange}
          />
        </div>
        {(displayedSaveStatus !== 'saved' || offline) && <span className={`${styles.saveStatus} ${styles[displayedSaveStatus]}`}>
          {statusText[displayedSaveStatus]}{displayedSaveStatus === 'error' && <button onClick={() => save(draftRef.current || {})}>Retry save</button>}
        </span>}
      </div>

      {remindAt && <div className={styles.reminderHelp}>
        {formatReminderTime(remindAt)} · Keep Notizen open for reminders.
        {notificationPermission === 'default' && <button onClick={enableNotifications}>Enable notifications</button>}
        {notificationPermission === 'denied' && <span> Notifications are blocked. Enable them in your browser or app notification settings to receive reminders.</span>}
        {notificationPermission === 'unsupported' && <span> System notifications are unavailable here.</span>}
      </div>}
      {reminderError && <div className={styles.reminderHelp} role="alert">{reminderError}</div>}
      {reminderDeliveryError && <div className={styles.reminderHelp} role="alert">{reminderDeliveryError}</div>}

      <input
        type="text"
        className={styles.titleInput}
        value={title}
        onChange={handleTitleChange}
        placeholder="Untitled"
      />

      <div
        ref={editorRef}
        className={styles.contentArea}
        contentEditable
        suppressContentEditableWarning
        onInput={handleEditorInput}
        onKeyDown={handleKeyDown}
        data-placeholder="Start writing..."
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        style={{ display: 'none' }}
      />
    </div>
  );
}
