import test from 'node:test';
import assert from 'node:assert/strict';
import { createUser, updatePassword } from '../src/server/manage-users.js';
import { verifyPassword } from '../src/server/auth.js';

test('manual account creation normalizes username and hashes password', async () => {
  const pool = {
    async query(sql, args) {
      assert.match(sql, /ON CONFLICT \(username\) DO NOTHING/);
      assert.equal(args[0], 'alice');
      assert.equal(await verifyPassword('long-test-password', args[1]), true);
      return { rows: [{ id: '1', username: args[0] }] };
    },
  };
  assert.deepEqual(await createUser(pool, ' Alice ', 'long-test-password'), {
    id: '1',
    username: 'alice',
  });
});

test('invalid accounts do not write to the database; duplicates do not overwrite', async () => {
  const pool = {
    query() {
      assert.fail('Invalid account reached database');
    },
  };
  await assert.rejects(createUser(pool, '!', 'long-test-password'), /Username/);
  await assert.rejects(createUser(pool, 'alice', 'short'), /Password/);
  await assert.rejects(
    createUser(
      {
        async query() {
          return { rows: [] };
        },
      },
      'alice',
      'long-test-password',
    ),
    /unavailable/,
  );
});

test('password update hashes credentials and revokes sessions in one statement', async () => {
  const pool = {
    async query(sql, args) {
      assert.match(
        sql,
        /UPDATE users SET password_hash = \$2 WHERE username = \$1/,
      );
      assert.match(
        sql,
        /DELETE FROM sessions WHERE user_id IN \(SELECT id FROM updated\)/,
      );
      assert.equal(args[0], 'alice');
      assert.equal(await verifyPassword('new-test-password', args[1]), true);
      return { rows: [{ id: '1', username: 'alice' }] };
    },
  };
  assert.equal(
    (await updatePassword(pool, ' ALICE ', 'new-test-password')).username,
    'alice',
  );
  await assert.rejects(
    updatePassword(
      {
        query() {
          assert.fail('Unexpected write');
        },
      },
      'alice',
      'short',
    ),
    /Password/,
  );
  await assert.rejects(
    updatePassword(
      {
        async query() {
          return { rows: [] };
        },
      },
      'missing',
      'new-test-password',
    ),
    /not found/,
  );
});
