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

## Manage accounts

With the database configured and the application started at least once:

```sh
npm run user:create -- alice
npm run user:password -- alice
```

Both commands prompt for a hidden password and confirmation (12–128 characters). Password updates sign out existing sessions.

## Deploy

Run one application service: Express serves both the compiled frontend and API. Nginx handles HTTPS, and PostgreSQL stores recipes, images, and accounts.

See [DEPLOYMENTS.md](DEPLOYMENTS.md) for VPS setup, the systemd unit, Nginx configuration, production account commands, and implementation details.
