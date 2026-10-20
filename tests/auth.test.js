import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server/app.js';
import { hashPassword, verifyPassword } from '../src/server/auth.js';
import { exampleToml, validateRecipe } from '../src/server/recipe.js';

test('password hashes use independent salts and verify only the right password', async () => {
  const hash = await hashPassword('a-long-test-password');
  assert.notEqual(hash, await hashPassword('a-long-test-password'));
  assert.equal(await verifyPassword('a-long-test-password', hash), true);
  assert.equal(await verifyPassword('another-test-password', hash), false);
});

// An in-memory query adapter exercises HTTP behavior without requiring a database.
function database() {
  const users = [],
    sessions = new Map(),
    recipes = [],
    images = [];
  return {
    async query(sql, args = []) {
      let rows = [];
      if (sql.startsWith('SELECT users.id')) {
        const session = sessions.get(args[0]);
        const user = session && users.find((u) => u.id === session);
        rows = user ? [{ id: user.id, username: user.username }] : [];
      } else if (sql.startsWith('INSERT INTO users')) {
        if (!users.some((u) => u.username === args[0])) {
          const user = {
            id: String(users.length + 1),
            username: args[0],
            password_hash: args[1],
          };
          users.push(user);
          rows = [{ id: user.id, username: user.username }];
        }
      } else if (sql.startsWith('SELECT * FROM users'))
        rows = users.filter((u) => u.username === args[0]);
      else if (sql.startsWith('INSERT INTO sessions'))
        sessions.set(args[0], args[1]);
      else if (sql.startsWith('DELETE FROM sessions WHERE token_hash'))
        sessions.delete(args[0]);
      else if (sql.startsWith('DELETE FROM sessions WHERE expires_at')) {
        /* No expired fixtures. */
      } else if (sql.startsWith('INSERT INTO images')) {
        images.push({
          id: args[0],
          user_id: args[1],
          mime: args[2],
          data: args[3],
        });
      } else if (sql.startsWith('SELECT mime, data FROM images')) {
        rows = images.filter((image) => image.id === args[0]);
      } else if (sql.startsWith('SELECT id FROM images')) {
        rows = images.filter(
          (image) => image.id === args[0] && image.user_id === args[1],
        );
      } else if (sql.startsWith('INSERT INTO recipes')) {
        const row = {
          id: String(recipes.length + 1),
          toml: args[0],
          user_id: args[1],
        };
        recipes.push(row);
        rows = [row];
      } else if (sql.startsWith('SELECT toml FROM recipes')) {
        rows = recipes
          .filter((recipe) => recipe.id === args[0])
          .map(({ toml }) => ({ toml }));
      } else if (sql.startsWith('SELECT recipes.*')) {
        assert.match(sql, /LEFT JOIN users/);
        rows = recipes.map((r) => ({
          ...r,
          author: users.find((u) => u.id === r.user_id)?.username || null,
        }));
      } else if (sql.startsWith('UPDATE recipes')) {
        assert.match(sql, /AND user_id = \$3/);
        const row = recipes.find(
          (r) => r.id === args[1] && r.user_id === args[2],
        );
        if (row) {
          row.toml = args[0];
          rows = [row];
        }
      } else if (sql.startsWith('DELETE FROM recipes')) {
        assert.match(sql, /AND user_id = \$2/);
        const index = recipes.findIndex(
          (r) => r.id === args[0] && r.user_id === args[1],
        );
        if (index >= 0) rows = recipes.splice(index, 1);
      } else throw new Error(`Unexpected query: ${sql}`);
      return { rows, rowCount: rows.length };
    },
  };
}

test('HTTP authentication, recipe ownership, validation, and logout', async (t) => {
  const app = await createApp(database());
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(route, method = 'GET', body, cookie) {
    return fetch(base + '/api' + route, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  for (const method of ['POST', 'PUT', 'DELETE'])
    assert.equal(
      (
        await call(
          '/recipes' + (['PUT', 'DELETE'].includes(method) ? '/1' : ''),
          method,
          method === 'GET' ? undefined : {},
        )
      ).status,
      401,
    );
  const first = await call('/auth/register', 'POST', {
    username: 'Alice',
    password: 'a-long-test-password',
  });
  assert.equal(first.status, 201);
  assert.match(first.headers.get('set-cookie'), /HttpOnly/);
  assert.match(first.headers.get('set-cookie'), /SameSite=Strict/);
  const alice = first.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (
      await call('/auth/register', 'POST', {
        username: 'alice',
        password: 'a-long-test-password',
      })
    ).status,
    409,
  );
  const second = await call('/auth/register', 'POST', {
    username: 'bob',
    password: 'another-long-password',
  });
  const bob = second.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (await call('/recipes', 'POST', { toml: 'invalid' }, alice)).status,
    400,
  );
  const imageBytes = Buffer.from('89504e470d0a1a0a0000', 'hex');
  const upload = (cookie) =>
    fetch(base + '/api/images', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: imageBytes,
    });
  assert.equal((await upload()).status, 401);
  const uploaded = await upload(alice);
  assert.equal(uploaded.status, 201);
  const { image } = await uploaded.json();
  const downloaded = await fetch(base + image);
  assert.equal(downloaded.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), imageBytes);
  const withImage = exampleToml + `\nimage = "${image}"`;
  assert.equal(
    (await call('/recipes', 'POST', { toml: withImage }, bob)).status,
    400,
  );
  const created = await call(
    '/recipes',
    'POST',
    { toml: withImage, user_id: '2', author: 'bob' },
    alice,
  );
  assert.equal(created.status, 201);
  const { id, author } = await created.json();
  assert.equal(author, 'alice');
  for (const cookie of [undefined, bob]) {
    const response = await call('/recipes', 'GET', undefined, cookie);
    assert.equal(response.status, 200);
    const shared = await response.json();
    assert.equal(shared.length, 1);
    assert.equal(shared[0].author, 'alice');
    assert.equal(shared[0].id, id);
  }
  for (const method of ['PUT', 'DELETE'])
    assert.equal(
      (await call(`/recipes/${id}`, method, { toml: exampleToml }, bob)).status,
      404,
    );
  assert.equal(
    (
      await call(
        `/recipes/${id}`,
        'PUT',
        { recipe: { ...validateRecipe(exampleToml), title: 'Updated recipe' } },
        alice,
      )
    ).status,
    200,
  );
  const updated = await (await call('/recipes')).json();
  assert.equal(updated[0].recipe.title, 'Updated recipe');
  assert.equal(validateRecipe(updated[0].toml).title, 'Updated recipe');
  assert.equal(
    (
      await call(
        `/recipes/${id}`,
        'PUT',
        { recipe: { title: 'Incomplete' } },
        alice,
      )
    ).status,
    400,
  );
  assert.equal((await call(`/recipes/${id}`, 'DELETE', {}, alice)).status, 204);
  assert.equal(
    (
      await call('/auth/login', 'POST', {
        username: 'alice',
        password: 'incorrect-password',
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call('/auth/login', 'POST', {
        username: 'ALICE',
        password: 'a-long-test-password',
      })
    ).status,
    200,
  );
  assert.equal((await call('/auth/logout', 'POST', {}, alice)).status, 204);
  assert.equal((await call('/auth/me', 'GET', undefined, alice)).status, 401);
  const crossOrigin = await fetch(base + '/api/auth/login', {
    method: 'POST',
    body: 'username=alice',
  });
  assert.equal(crossOrigin.status, 415);
});

test('proxy trust is opt-in and restricted to loopback', async () => {
  const previous = process.env.TRUST_PROXY;
  try {
    delete process.env.TRUST_PROXY;
    assert.equal((await createApp(database())).get('trust proxy'), false);
    process.env.TRUST_PROXY = 'loopback';
    const trust = (await createApp(database())).get('trust proxy fn');
    assert.equal(trust('127.0.0.1'), true);
    assert.equal(trust('::1'), true);
    assert.equal(trust('198.51.100.1'), false);
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  }
});

test('TOML file import and public downloads preserve the backend document', async (t) => {
  const server = (await createApp(database())).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const example = await readFile(
    new URL('../assets/example-recipe.toml', import.meta.url),
    'utf8',
  );
  const sample = await fetch(base + '/api/recipes/example.toml');
  assert.equal(sample.status, 200);
  assert.match(sample.headers.get('content-type'), /^application\/toml/);
  assert.match(
    sample.headers.get('content-disposition'),
    /attachment;.*example-recipe.toml/,
  );
  assert.equal(await sample.text(), example);
  const parsed = validateRecipe(example);
  assert.equal(
    parsed.ingredients.find((item) => item.name === 'Curry powder').quantity,
    '1 tablespoon',
  );
  assert.ok(parsed.steps[0].includes('\n\n'));
  async function importFile(toml, cookie) {
    return fetch(base + '/api/recipes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({ toml }),
    });
  }
  assert.equal((await importFile(example)).status, 401);
  const registration = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'importer',
      password: 'long-test-password',
    }),
  });
  assert.equal(registration.status, 201);
  const cookie = registration.headers.get('set-cookie').split(';')[0];
  // Lots of quotes exercise JSON encoding overhead while staying below 100 KB TOML.
  const source =
    '# Café 🍛 "family favorite"\n# ' +
    '"'.repeat(60000) +
    '\n' +
    example +
    '\nsource = "Family cookbook"\n';
  const imported = await importFile(source, cookie);
  assert.equal(imported.status, 201);
  const item = await imported.json();
  assert.equal(item.author, 'importer');
  assert.equal(item.toml, source);
  assert.equal(item.recipe.source, 'Family cookbook');
  const download = await fetch(`${base}/api/recipes/${item.id}/toml`);
  assert.equal(download.status, 200);
  assert.match(
    download.headers.get('content-disposition'),
    new RegExp(`attachment;.*recipe-${item.id}\\.toml`),
  );
  assert.match(
    download.headers.get('content-type'),
    /^application\/toml; charset=utf-8/,
  );
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(
    Buffer.from(await download.arrayBuffer()),
    Buffer.from(source),
  );
  assert.equal((await fetch(base + '/api/recipes/999/toml')).status, 404);
  assert.equal((await fetch(base + '/api/recipes/not-an-id/toml')).status, 400);
  for (const invalid of [
    '',
    'title = "',
    'title = "Incomplete"',
    '# ' + 'é'.repeat(50000),
  ])
    assert.equal((await importFile(invalid, cookie)).status, 400);
  const list = await (await fetch(base + '/api/recipes')).json();
  assert.equal(list.length, 1, 'Invalid imports must not create recipes');
});
