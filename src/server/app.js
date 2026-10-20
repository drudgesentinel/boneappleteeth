import express from 'express';
import { randomUUID } from 'node:crypto';
import { validateImage } from './image.js';
import { installAuth } from './auth.js';
import path from 'node:path';
import { validateRecipe, recipeToToml } from './recipe.js';
export async function createApp(pool) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === 'loopback')
    app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '110kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  await installAuth(app, pool);
  app.param('id', (req, res, next, id) =>
    /^\d+$/.test(id) && id.length < 19
      ? next()
      : res.status(400).json({ error: 'Invalid recipe ID.' }),
  );
  app.post(
    '/api/images',
    express.raw({
      type: ['image/png', 'image/jpeg', 'image/webp'],
      limit: '5mb',
    }),
    async (req, res) => {
      try {
        validateImage(req.body, req.get('Content-Type'));
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      const id = randomUUID();
      await pool.query(
        'INSERT INTO images (id, user_id, mime, data) VALUES ($1, $2, $3, $4)',
        [id, req.user.id, req.get('Content-Type'), req.body],
      );
      res.status(201).json({ image: `/api/images/${id}` });
    },
  );
  app.get('/api/images/:imageId', async (req, res) => {
    if (!/^[a-f0-9-]{36}$/.test(req.params.imageId))
      return res.status(404).end();
    const { rows } = await pool.query(
      'SELECT mime, data FROM images WHERE id = $1',
      [req.params.imageId],
    );
    if (!rows.length) return res.status(404).end();
    res
      .set('X-Content-Type-Options', 'nosniff')
      .type(rows[0].mime)
      .send(rows[0].data);
  });
  const serialize = (row) => ({ ...row, recipe: validateRecipe(row.toml) });
  app.get('/api/recipes', async (req, res) => {
    const { rows } = await pool.query(
      'SELECT recipes.*, users.username AS author FROM recipes LEFT JOIN users ON users.id = recipes.user_id ORDER BY recipes.updated_at DESC, recipes.id DESC',
    );
    res.json(rows.map(serialize));
  });
  async function validate(req, res, next) {
    let recipe;
    try {
      req.recipeToml =
        req.body?.recipe !== undefined
          ? recipeToToml(req.body.recipe)
          : req.body?.toml;
      recipe = validateRecipe(req.recipeToml);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    if (recipe.image) {
      const { rows } = await pool.query(
        'SELECT id FROM images WHERE id = $1 AND user_id = $2',
        [recipe.image.split('/').pop(), req.user.id],
      );
      if (!rows.length)
        return res
          .status(400)
          .json({ error: 'Use an image uploaded by your account.' });
    }
    next();
  }
  app.post('/api/recipes', validate, async (req, res) => {
    const { rows } = await pool.query(
      'INSERT INTO recipes (toml, user_id) VALUES ($1, $2) RETURNING *',
      [req.recipeToml, req.user.id],
    );
    res.status(201).json(serialize({ ...rows[0], author: req.user.username }));
  });
  app.put('/api/recipes/:id', validate, async (req, res) => {
    const { rows } = await pool.query(
      'UPDATE recipes SET toml = $1, updated_at = now() WHERE id = $2 AND user_id = $3 RETURNING *',
      [req.recipeToml, req.params.id, req.user.id],
    );
    if (!rows.length)
      return res.status(404).json({ error: 'Recipe not found.' });
    res.json(serialize({ ...rows[0], author: req.user.username }));
  });
  app.delete('/api/recipes/:id', async (req, res) => {
    const result = await pool.query(
      'DELETE FROM recipes WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id],
    );
    if (!result.rowCount)
      return res.status(404).json({ error: 'Recipe not found.' });
    res.status(204).end();
  });
  app.use('/api', (req, res) =>
    res.status(404).json({ error: 'API endpoint not found.' }),
  );
  app.use(express.static(path.resolve('dist')));
  app.get('/{*path}', (req, res) =>
    res.sendFile(path.resolve('dist/index.html')),
  );
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'Invalid JSON body.' });
    if (error.status === 413)
      return res
        .status(413)
        .json({ error: 'Upload exceeds the allowed size.' });
    console.error(error);
    res
      .status(500)
      .json({ error: 'Unable to complete the request. Please try again.' });
  });
  return app;
}
