import { hashPassword } from './auth.js';

function validateCredentials(username, password) {
  username = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (!/^[a-z0-9_]{3,32}$/.test(username))
    throw new Error(
      'Username must contain 3–32 letters, numbers, or underscores.',
    );
  if (
    typeof password !== 'string' ||
    password.length < 12 ||
    password.length > 128
  )
    throw new Error('Password must contain 12–128 characters.');
  return username;
}

export async function createUser(pool, username, password) {
  username = validateCredentials(username, password);
  const { rows } = await pool.query(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING RETURNING id, username',
    [username, await hashPassword(password)],
  );
  if (!rows.length)
    throw new Error('Username is unavailable. No account was changed.');
  return rows[0];
}

export async function updatePassword(pool, username, password) {
  username = validateCredentials(username, password);
  const { rows } = await pool.query(
    `WITH updated AS (
      UPDATE users SET password_hash = $2 WHERE username = $1 RETURNING id, username
    ), revoked AS (
      DELETE FROM sessions WHERE user_id IN (SELECT id FROM updated)
    ) SELECT id, username FROM updated`,
    [username, await hashPassword(password)],
  );
  if (!rows.length) throw new Error('User not found. No account was changed.');
  return rows[0];
}
