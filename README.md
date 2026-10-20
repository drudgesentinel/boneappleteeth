# hotdogcart

A recipe book built with Svelte, Express, and PostgreSQL. Browse and search recipes, then sign in to add your own recipes with ingredients, quantities, costs, and images.

## Run locally

Requires Node.js 24 and Podman with a Compose provider (or an existing PostgreSQL database).

```sh
nvm install
nvm use
npm ci
cp .env.example .env
podman compose up -d db
npm run dev
```

Open http://localhost:5173. To use an existing database, set `DATABASE_URL` in `.env`.

## Common commands

- `npm test`: run tests.
- `npm run build`: build the frontend.
- `npm start`: serve the built frontend and API.
- `npm run format`: format the repository.
- `npm run seed:test-user`: create the local-only test account `foo` / `bar`.

## Recipe TOML files

Sign in and choose **Import recipe TOML** to add a recipe from a `.toml` file (up to 100 KB). Use **Download TOML** on any recipe to save its stored document, or start with the [example recipe](assets/example-recipe.toml). Ingredient names display before their quantities.

## Manage accounts

On the VPS, run these from your root SSH session to create `sean` or update their password:

```sh
runuser -u hotdogcart -- /usr/bin/node \
  --env-file=/etc/hotdogcart/hotdogcart.env \
  /opt/hotdogcart/scripts/create-user.js sean

runuser -u hotdogcart -- /usr/bin/node \
  --env-file=/etc/hotdogcart/hotdogcart.env \
  /opt/hotdogcart/scripts/create-user.js --password sean
```

These run as `hotdogcart` and load the production database configuration. Both prompt for a hidden password and confirmation (12–128 characters). Password updates sign out existing sessions.

For local development with `DATABASE_URL` in `.env`, use `npm run user:create -- sean` and `npm run user:password -- sean` after the application has initialized the database.

## Deploy

Run one application service: Express serves both the compiled frontend and API. Nginx handles HTTPS, and PostgreSQL stores recipes, images, and accounts.

See [DEPLOYMENTS.md](DEPLOYMENTS.md) for VPS setup, the systemd unit, Nginx configuration, production account commands, and implementation details.
