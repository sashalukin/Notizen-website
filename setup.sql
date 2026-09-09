CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  name       TEXT,
  email      TEXT UNIQUE,
  image      TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT REFERENCES users(id) ON DELETE CASCADE,
  type                TEXT,
  provider            TEXT,
  provider_account_id TEXT,
  refresh_token       TEXT,
  access_token        TEXT,
  expires_at          INTEGER,
  token_type          TEXT,
  scope               TEXT,
  id_token            TEXT,
  session_state       TEXT,
  UNIQUE(provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  session_token TEXT UNIQUE,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires       TIMESTAMP
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier TEXT,
  token      TEXT,
  expires    TIMESTAMP,
  UNIQUE(identifier, token)
);

CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  title      TEXT DEFAULT 'Untitled',
  content    TEXT DEFAULT '',
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  remind_at  TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS android_auth_codes (
  code           TEXT PRIMARY KEY,
  session_token  TEXT NOT NULL,
  code_challenge TEXT,
  created_at     TIMESTAMP DEFAULT NOW()
);
