import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Discord from './auth-providers/discord';
import pool from './db';
import crypto from 'crypto';

function generateId() {
  return crypto.randomUUID();
}

const PostgresAdapter = {
  async createUser(user) {
    const id = generateId();
    const result = await pool.query(
      'INSERT INTO users (id, name, email, image) VALUES ($1, $2, $3, $4) RETURNING *',
      [id, user.name, user.email, user.image]
    );
    const row = result.rows[0];
    return { id: row.id, name: row.name, email: row.email, image: row.image, emailVerified: null };
  },

  async getUser(id) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return { id: row.id, name: row.name, email: row.email, image: row.image, emailVerified: null };
  },

  async getUserByEmail(email) {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return { id: row.id, name: row.name, email: row.email, image: row.image, emailVerified: null };
  },

  async getUserByAccount({ provider, providerAccountId }) {
    const result = await pool.query(
      `SELECT u.* FROM users u
       JOIN accounts a ON u.id = a.user_id
       WHERE a.provider = $1 AND a.provider_account_id = $2`,
      [provider, providerAccountId]
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return { id: row.id, name: row.name, email: row.email, image: row.image, emailVerified: null };
  },

  async updateUser(user) {
    const result = await pool.query(
      'UPDATE users SET name = COALESCE($2, name), email = COALESCE($3, email), image = COALESCE($4, image) WHERE id = $1 RETURNING *',
      [user.id, user.name, user.email, user.image]
    );
    const row = result.rows[0];
    return { id: row.id, name: row.name, email: row.email, image: row.image, emailVerified: null };
  },

  async deleteUser(userId) {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  },

  async linkAccount(account) {
    const id = generateId();
    await pool.query(
      `INSERT INTO accounts (id, user_id, type, provider, provider_account_id, refresh_token, access_token, expires_at, token_type, scope, id_token, session_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, account.userId, account.type, account.provider, account.providerAccountId,
       account.refresh_token, account.access_token, account.expires_at,
       account.token_type, account.scope, account.id_token, account.session_state]
    );
    return account;
  },

  async unlinkAccount({ provider, providerAccountId }) {
    await pool.query(
      'DELETE FROM accounts WHERE provider = $1 AND provider_account_id = $2',
      [provider, providerAccountId]
    );
  },

  async createSession(session) {
    const id = generateId();
    await pool.query(
      'INSERT INTO sessions (id, session_token, user_id, expires) VALUES ($1, $2, $3, $4)',
      [id, session.sessionToken, session.userId, session.expires]
    );
    return session;
  },

  async getSessionAndUser(sessionToken) {
    const result = await pool.query(
      `SELECT s.*, u.id as u_id, u.name as u_name, u.email as u_email, u.image as u_image
       FROM sessions s JOIN users u ON s.user_id = u.id
       WHERE s.session_token = $1`,
      [sessionToken]
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      session: { sessionToken: row.session_token, userId: row.user_id, expires: row.expires },
      user: { id: row.u_id, name: row.u_name, email: row.u_email, image: row.u_image, emailVerified: null },
    };
  },

  async updateSession(session) {
    const result = await pool.query(
      'UPDATE sessions SET expires = $2 WHERE session_token = $1 RETURNING *',
      [session.sessionToken, session.expires]
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return { sessionToken: row.session_token, userId: row.user_id, expires: row.expires };
  },

  async deleteSession(sessionToken) {
    await pool.query('DELETE FROM sessions WHERE session_token = $1', [sessionToken]);
  },

  async createVerificationToken(token) {
    await pool.query(
      'INSERT INTO verification_tokens (identifier, token, expires) VALUES ($1, $2, $3)',
      [token.identifier, token.token, token.expires]
    );
    return token;
  },

  async useVerificationToken({ identifier, token }) {
    const result = await pool.query(
      'DELETE FROM verification_tokens WHERE identifier = $1 AND token = $2 RETURNING *',
      [identifier, token]
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return { identifier: row.identifier, token: row.token, expires: row.expires };
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter,
  providers: [
    ...(process.env.AUTH_DISCORD_ID && process.env.AUTH_DISCORD_SECRET ? [Discord({
      clientId: process.env.AUTH_DISCORD_ID,
      clientSecret: process.env.AUTH_DISCORD_SECRET,
    })] : []),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/signin',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
      }
      return session;
    },
  },
});
