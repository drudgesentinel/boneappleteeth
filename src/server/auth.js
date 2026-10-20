import {
  randomBytes,
  scrypt as derive,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(':');
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}
export const cookieName = 'recipe_session';
export function sessionToken(req) {
  return (req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}
export async function installAuth(app, pool) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
  // JSON-only mutations prevent browser cross-origin form submissions.
  app.use('/api', (req, res, next) => {
    if (
      ['POST', 'PUT', 'DELETE'].includes(req.method) &&
      !req.is('application/json') &&
      !(
        req.method === 'POST' &&
        req.path === '/images' &&
        ['image/png', 'image/jpeg', 'image/webp'].includes(
          req.get('Content-Type'),
        )
      )
    )
      return res
        .status(415)
        .json({ error: 'Use application/json for API changes.' });
    next();
  });
  app.use('/api', async (req, res, next) => {
    const token = sessionToken(req);
    if (token) {
      const { rows } = await pool.query(
        'SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = $1 AND expires_at > now()',
        [tokenHash(token)],
      );
      req.user = rows[0];
    }
    next();
  });
  const attempts = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of attempts)
      if (value.until < now) attempts.delete(key);
  }, 60_000);
  timer.unref();
  function limit(req, res, next) {
    const key = req.ip;
    let entry = attempts.get(key);
    if (!entry || entry.until < Date.now()) {
      entry = { count: 0, until: Date.now() + 900_000 };
      attempts.set(key, entry);
    }
    if (++entry.count > 30)
      return res
        .status(429)
        .json({ error: 'Too many attempts. Try again in 15 minutes.' });
    next();
  }
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  for (const action of ['register', 'login'])
    app.post(`/api/auth/${action}`, limit, async (req, res) => {
      const username =
        typeof req.body?.username === 'string'
          ? req.body.username.trim().toLowerCase()
          : '';
      const password = req.body?.password;
      if (
        !/^[a-z0-9_]{3,32}$/.test(username) ||
        typeof password !== 'string' ||
        password.length < (action === 'register' ? 12 : 1) ||
        password.length > 128
      )
        return res.status(400).json({
          error:
            'Use a username of 3–32 letters, numbers, or underscores and a password of 12–128 characters.',
        });
      let user;
      if (action === 'register') {
        const hash = await hashPassword(password);
        const { rows } = await pool.query(
          'INSERT INTO users (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING RETURNING id, username',
          [username, hash],
        );
        if (!rows.length)
          return res.status(409).json({ error: 'Username is unavailable.' });
        user = rows[0];
      } else {
        const { rows } = await pool.query(
          'SELECT * FROM users WHERE username = $1',
          [username],
        );
        const valid = await verifyPassword(
          password,
          rows[0]?.password_hash || dummyHash,
        );
        if (!rows.length || !valid)
          return res
            .status(401)
            .json({ error: 'Invalid username or password.' });
        user = { id: rows[0].id, username: rows[0].username };
      }
      const oldToken = sessionToken(req);
      if (oldToken)
        await pool.query('DELETE FROM sessions WHERE token_hash = $1', [
          tokenHash(oldToken),
        ]);
      await pool.query('DELETE FROM sessions WHERE expires_at <= now()');
      const token = randomBytes(32).toString('hex');
      await pool.query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '7 days')",
        [tokenHash(token), user.id],
      );
      res.cookie(cookieName, token, {
        ...cookieOptions,
        maxAge: 7 * 86400_000,
      });
      res.status(action === 'register' ? 201 : 200).json(user);
    });
  app.get('/api/auth/me', (req, res) =>
    req.user
      ? res.json(req.user)
      : res.status(401).json({ error: 'Sign in to continue.' }),
  );
  app.post('/api/auth/logout', async (req, res) => {
    const token = sessionToken(req);
    if (token)
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [
        tokenHash(token),
      ]);
    res.clearCookie(cookieName, cookieOptions).status(204).end();
  });
  app.use(['/api/recipes', '/api/images'], (req, res, next) =>
    ['GET', 'HEAD'].includes(req.method) || req.user
      ? next()
      : res.status(401).json({ error: 'Sign in to contribute recipes.' }),
  );
}
