'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import styles from './NoteEditor.module.css';

export default function NoteEditor({ note }) {
  const [title, setTitle] = useState(note.title || '');
  const [saveStatus, setSaveStatus] = useState('saved');
  const [remindAt, setRemindAt] = useState(note.remind_at || null);
  const editorRef = useRef(null);
  const saveTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const reminderInputRef = useRef(null);

  // Initialize editor content
  useEffect(() => {
    if (editorRef.current && note.content) {
      editorRef.current.innerHTML = note.content;
    }
  }, [note.id]);

  // Update browser tab title
  useEffect(() => {
    document.title = title || 'Untitled';
    return () => { document.title = 'Notizen'; };
  }, [title]);

  // Listen for reminder-cleared events from Sidebar
  useEffect(() => {
    function handleReminderCleared(e) {
      if (e.detail?.noteId === note.id) {
        setRemindAt(null);
      }
    }
    window.addEventListener('reminder-cleared', handleReminderCleared);
    return () => window.removeEventListener('reminder-cleared', handleReminderCleared);
  }, [note.id]);

  const save = useCallback(async (data) => {
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setSaveStatus('saved');
        window.dispatchEvent(new CustomEvent('note-updated'));
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    }
  }, [note.id]);

  const debouncedSave = useCallback((data) => {
    setSaveStatus('unsaved');
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      save(data);
    }, 1000);
  }, [save]);

  function handleTitleChange(e) {
    const newTitle = e.target.value;
    setTitle(newTitle);
    debouncedSave({
      title: newTitle,
      content: editorRef.current?.innerHTML || '',
    });
  }

  function handleEditorInput() {
    debouncedSave({
      title,
      content: editorRef.current?.innerHTML || '',
    });
  }

  function handleBold() {
    document.execCommand('bold');
    editorRef.current?.focus();
  }

  function handleImageClick() {
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
    element.innerHTML = `<h1 style="font-size:24px;font-weight:700;margin-bottom:12px;">${title || 'Untitled'}</h1>` + (editorRef.current?.innerHTML || '');
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
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      reminderInputRef.current?.showPicker();
    }
  }

  async function handleSetReminder(dateStr) {
    const res = await fetch(`/api/notes/${note.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remind_at: dateStr }),
    });
    if (res.ok) {
      setRemindAt(dateStr);
      window.dispatchEvent(new CustomEvent('note-updated'));
    }
  }

  async function handleClearReminder() {
    const res = await fetch(`/api/notes/${note.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remind_at: null }),
    });
    if (res.ok) {
      setRemindAt(null);
      window.dispatchEvent(new CustomEvent('note-updated'));
    }
  }

  function handleReminderChange(e) {
    if (e.target.value) {
      handleSetReminder(new Date(e.target.value).toISOString());
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
    saved: 'Saved',
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
        <span className={`${styles.saveStatus} ${styles[saveStatus]}`}>
          {statusText[saveStatus]}
        </span>
      </div>

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
