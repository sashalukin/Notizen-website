import styles from './layout.module.css';

export default function NotesPage() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: 'var(--text-meta)',
      fontSize: '16px',
    }}>
      Select a note or create a new one
    </div>
  );
}
