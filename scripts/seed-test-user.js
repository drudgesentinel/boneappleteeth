import pg from 'pg';
import { initializeSchema } from '../src/server/schema.js';
import { hashPassword, verifyPassword } from '../src/server/auth.js';

const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (
  process.env.NODE_ENV === 'production' ||
  !url ||
  !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
) {
  throw new Error(
    'The test user can only be seeded into a local development database.',
  );
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
try {
  await initializeSchema(pool);
  const hash = await hashPassword('bar');
  const { rows } = await pool.query(
    `
    INSERT INTO users (username, password_hash) VALUES ($1, $2)
    ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
    RETURNING username, password_hash
  `,
    ['foo', hash],
  );
  if (!(await verifyPassword('bar', rows[0].password_hash)))
    throw new Error('Test user verification failed.');
  console.log('Test user foo is ready (password: bar).');
} catch (error) {
  console.error(
    `Could not seed test user: ${error.code ? error.code + ': ' : ''}${error.message}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
