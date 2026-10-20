import pg from 'pg';
import { initializeSchema } from './schema.js';
import { createApp } from './app.js';
if (!process.env.DATABASE_URL)
  throw new Error('Set DATABASE_URL in .env (see .env.example).');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (error) => console.error('Database pool error:', error));
await initializeSchema(pool);
const app = await createApp(pool);
const server = app.listen(
  process.env.PORT || 3000,
  process.env.HOST || '127.0.0.1',
  () => console.log(`Recipe API listening on port ${process.env.PORT || 3000}`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(async () => {
      await pool.end();
      process.exit(0);
    }),
  );
