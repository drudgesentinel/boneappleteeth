import pg from 'pg';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { createUser, updatePassword } from '../src/server/manage-users.js';

async function readPassword() {
  if (!process.stdin.isTTY) {
    let value = '';
    for await (const chunk of process.stdin) {
      value += chunk;
      if (Buffer.byteLength(value) > 1024)
        throw new Error('Password input is too long.');
    }
    return value.replace(/\r?\n$/, '');
  }
  // Readline enables raw mode; suppress its output so typed secrets stay hidden.
  const output = new Writable({
    write(chunk, encoding, done) {
      done();
    },
  });
  const terminal = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  try {
    process.stdout.write('Password (hidden): ');
    const password = await terminal.question('');
    process.stdout.write('\nConfirm password (hidden): ');
    if (password !== (await terminal.question('')))
      throw new Error('Passwords do not match.');
    return password;
  } finally {
    terminal.close();
    process.stdout.write('\n');
  }
}

const updating = process.argv[2] === '--password';
const args = process.argv.slice(updating ? 3 : 2);
let pool;
try {
  if (args.length !== 1 || ['--help', '-h'].includes(args[0])) {
    console.log(
      'Usage: npm run user:create -- <username>\n       npm run user:password -- <username>\nPrompts for a hidden password, or reads it from standard input.',
    );
    if (!['--help', '-h'].includes(args[0])) process.exitCode = 1;
  } else {
    if (!process.env.DATABASE_URL)
      throw new Error('Set DATABASE_URL before managing accounts.');
    const password = await readPassword();
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
    });
    const user = await (updating ? updatePassword : createUser)(
      pool,
      args[0],
      password,
    );
    console.log(
      `${updating ? 'Updated password for' : 'Created'} application user ${user.username} (ID ${user.id}).`,
    );
  }
} catch (error) {
  // Database errors can contain connection details; only expose expected errors.
  console.error(
    error.code
      ? 'Could not manage user. Check database connectivity and schema.'
      : error.message,
  );
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
}
