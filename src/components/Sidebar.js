'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import UserMenu from './UserMenu';
import styles from './Sidebar.module.css';

export default function Sidebar() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const activeNoteId = pathname.startsWith('/notes/') ? pathname.split('/')[2] : null;

  async function fetchNotes() {
    try {
      const res = await fetch('/api/notes');
      if (res.ok) {
        const data = await res.json();
        setNotes(data);
      }
    } catch (err) {
      console.error('Failed to fetch notes:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchNotes();
  }, [pathname]);

  useEffect(() => {
    function handleNoteUpdated() {
      fetchNotes();
    }
    window.addEventListener('note-updated', handleNoteUpdated);
    return () => window.removeEventListener('note-updated', handleNoteUpdated);
  }, []);

  async function handleNewNote() {
    try {
      const res = await fetch('/api/notes', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        router.push(`/notes/${data.id}`);
      }
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  }

  function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?(p|div|li|h[1-6])[^>]*>/gi, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  async function handleDeleteNote(e, noteId) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this note?')) return;

    try {
      const res = await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
      if (res.ok) {
        if (activeNoteId === noteId) {
          router.push('/notes');
        }
        fetchNotes();
      }
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <h2 className={styles.title}>Notizen</h2>
        <button className={styles.newButton} onClick={handleNewNote} title="New Note">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
        </button>
      </div>

      <div className={styles.noteList}>
        {loading ? (
          <div className={styles.emptyState}>Loading...</div>
        ) : notes.length === 0 ? (
          <div className={styles.emptyState}>No notes yet</div>
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              className={`${styles.noteItem} ${activeNoteId === note.id ? styles.active : ''}`}
              onClick={() => router.push(`/notes/${note.id}`)}
            >
              <div className={styles.noteItemHeader}>
                <span className={styles.noteTitle}>{note.title || 'Untitled'}</span>
                <button
                  className={styles.deleteButton}
                  onClick={(e) => handleDeleteNote(e, note.id)}
                  title="Delete note"
                >
                  &times;
                </button>
              </div>
              <div className={styles.notePreview}>
                <span className={styles.noteSnippet}>
                  {stripHtml(note.content).substring(0, 80) || 'No content'}
                </span>
                <span className={styles.noteDate}>{formatDate(note.updated_at)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <UserMenu />
    </aside>
  );
}
