'use client';

import styles from './UserMenu.module.css';

export default function UserMenu({ user, onSignOut }) {
  const session = user ? { user } : null;

  if (!session?.user) return null;

  return (
    <div className={styles.container}>
      <div className={styles.userInfo}>
        {session.user.image ? (
          <img
            src={session.user.image}
            alt=""
            className={styles.avatar}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className={styles.avatarPlaceholder}>
            {(session.user.name || session.user.email || '?')[0].toUpperCase()}
          </div>
        )}
        <span className={styles.userName}>
          {session.user.name || session.user.email}
        </span>
      </div>
      <button
        className={styles.downloadButton}
        onClick={() => {}}
      >
        Download App
      </button>
      <button
        className={styles.signOutButton}
        onClick={onSignOut}
        title="Sign out"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
      </button>
    </div>
  );
}
