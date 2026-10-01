-- Additive migration. The legacy android_auth_codes table, if present, is unused.
CREATE TABLE IF NOT EXISTS android_oauth_handoffs (
  code_hash TEXT PRIMARY KEY,
  code_challenge TEXT NOT NULL,
  session_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS android_oauth_expiry ON android_oauth_handoffs(expires_at);
