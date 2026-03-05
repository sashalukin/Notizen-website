import Sidebar from '@/components/Sidebar';
import styles from './layout.module.css';

export default function NotesLayout({ children }) {
  return (
    <div className={styles.container}>
      <Sidebar />
      <main className={styles.content}>
        {children}
      </main>
    </div>
  );
}
