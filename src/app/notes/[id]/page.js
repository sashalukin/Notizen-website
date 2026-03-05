'use client';

import { useState, useEffect, use } from 'react';
import NoteEditor from '@/components/NoteEditor';

export default function NotePage({ params }) {
  const { id } = use(params);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchNote() {
      try {
        const res = await fetch(`/api/notes/${id}`);
        if (res.ok) {
          const data = await res.json();
          setNote(data);
        } else {
          setError('Note not found');
        }
      } catch {
        setError('Failed to load note');
      }
    }
    fetchNote();
  }, [id]);

  if (error) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text-meta)',
        fontSize: '16px',
      }}>
        {error}
      </div>
    );
  }

  if (!note) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text-meta)',
        fontSize: '16px',
      }}>
        Loading...
      </div>
    );
  }

  return <NoteEditor key={note.id} note={note} />;
}
