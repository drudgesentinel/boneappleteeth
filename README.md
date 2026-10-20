# Bone Apple Teeth

A simple personal recipe book built with **Express 5**, **Svelte 5**, and **PostgreSQL**. Browse and search recipes publicly. Register with a username and password to contribute recipes, then edit or delete your own contributions. The editor collects individual recipe fields, ingredient rows, and instruction steps. The backend converts submitted recipe objects to TOML, validates them, and stores them in a PostgreSQL `text` column.

## Run locally

Requires Node.js 24 LTS and rootless Podman with a Compose provider (or an existing PostgreSQL database).

With [nvm](https://github.com/nvm-sh/nvm) installed, the following commands select the latest Node.js 24 release. `.nvmrc` selects this LTS line, and npm enforces it through `engines` and `.npmrc`.

```sh
nvm install
nvm use
npm install
cp .env.example .env
podman compose up -d db
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` requests to Express on port 3000. Express creates the `recipes` table at startup. Set `DATABASE_URL` in `.env` to use an existing database. Database credentials in the example are for local development.

Run these commands as your regular user; no `sudo` is needed for a configured rootless Podman installation. `podman compose` requires an external Compose provider, such as `podman-compose`; see the [Podman Compose documentation](https://docs.podman.io/en/latest/markdown/podman-compose.1.html).

## Commands

- `npm run dev`: start Express with file watching and Vite with hot reload.
- `npm run build`: compile the Svelte frontend into `dist/`.
- `npm start`: serve the compiled frontend and API on http://localhost:3000.
- `npm test`: run validation and API tests with Node's test runner.
- `npm run format`: format code with Prettier and its Svelte plugin.
- `podman compose down`: stop PostgreSQL while retaining recipes in its named volume.

## Local test account

Run `npm run seed:test-user` to create or reset username `foo` with password `bar` in the local database configured by `.env`. The command initializes missing database tables before seeding, so the app does not need to run first. This fixture is blocked for production and remote databases. New registrations still require at least 12 password characters; login accepts the short test password.

## Recipe format

```toml
title = "Tomato toast"
description = "A quick summer lunch."
servings = 1
minutes = 10
tags = ["lunch", "vegetarian"]
# Optional inspiration link:
# reference = "https://example.com/recipes/tomato-toast"
ingredients = ["1 slice sourdough", "1 ripe tomato", "Olive oil and salt"]
steps = ["Toast the bread.", "Slice the tomato, arrange on toast, and season."]
```

`title`, `ingredients`, and `steps` are required. Ingredients are strings or inline tables with `name`, optional `quantity`, and optional `cost`; `steps` contains the cooking instructions in order. Both arrays must contain at least one nonempty string. The optional `reference` field is an absolute HTTP or HTTPS link to the inspiring recipe, displayed separately from contributor attribution. Omit it when there is no reference. `servings` and `minutes`, when supplied, must be positive integers. Additional metadata is retained when editing existing recipes; form saves regenerate TOML formatting and remove TOML comments. Documents are limited to 100 KB.

### Ingredient costs

Use an inline table for each ingredient that has a quantity or cost. Quantity accepts nonempty text such as `"200 g"`, `"1/2 cup"`, or `"to taste"`, or a nonnegative number. The editor has separate ingredient name and quantity fields; legacy strings remain supported. The amount is the estimated cost of the quantity used in this recipe, rather than the price of a whole package.

```toml
ingredients = [
  { name = "spaghetti", quantity = "200 g", cost = { amount = 1.20, currency = "USD" } },
  { name = "1 lemon", cost = { amount = 0.60, currency = "USD" } },
  "Salt and pepper", # cost can be omitted
]
```

Plain strings remain supported, and both forms can be mixed. Each supplied ingredient cost requires a nonnegative numeric amount or nonempty text (for example `"1.99/pound"`), plus a currency. Costs are displayed as entered. Total recipe cost is supplied separately by the user; ingredient costs are never automatically totaled. All costs in a recipe must use the same currency. Ingredient costs appear beside their ingredients and are searchable by ingredient name. The optional recipe total is entered by the user and may also contain text.

### Optional images, nutrition, and cost

Use the editor’s image picker to upload a PNG, JPEG, or WebP file (maximum 5 MB). Images are stored in PostgreSQL and referenced by a root-level `image` path. Image upload requires sign-in; recipes can only reference images uploaded by their author. Images are publicly readable. Removing or replacing an image reference does not delete its stored bytes; canceled uploads are retained for now.

Place root-level fields before TOML table headers:

```toml
# Alongside title, ingredients, steps, and reference:
image = "/api/images/12345678-1234-1234-1234-123456789abc" # use the returned upload path

[nutrition] # all values per serving; any subset is allowed
calories_kcal = 450
protein_g = 15.5
carbs_g = 60
fat_g = 16

[cost] # estimated total for the whole recipe
amount = 6.50
currency = "USD"
```

All three additions are optional. Nutrition values must be finite, nonnegative numbers. Cost amounts accept nonnegative numbers or nonempty text. Cost requires both `amount` and a three-letter uppercase currency code. These values are supplied by contributors, not calculated automatically.

`POST /api/images` accepts raw image bytes with the matching `Content-Type` and session cookie, and returns `{ "image": "/api/images/<uuid>" }`. `GET /api/images/:imageId` returns the stored image. Restart the server to create the image table on an existing installation.

## Structure and API

- `src/client/`: Svelte interface and responsive styles.
- `src/server/`: Express routes, database initialization, and TOML validation.
- `tests/`: validation and HTTP API tests.

`GET /api/recipes` lists recipes. `POST /api/recipes` creates one; `PUT /api/recipes/:id` updates it. Both writes accept JSON `{ "recipe": { "title": "Toast", "ingredients": ["Bread"], "steps": ["Toast the bread."] } }`; the backend serializes and validates TOML before storing it. Legacy JSON `{ "toml": "..." }` requests remain supported and retain their original document formatting. `DELETE /api/recipes/:id` deletes one. Records include their ID, original TOML, parsed recipe, and timestamps. Search runs locally across titles, descriptions, tags, and ingredients.

## Accounts and access

`POST /api/auth/register` and `POST /api/auth/login` accept JSON `{ "username": "sean", "password": "a-long-unique-password" }`. Usernames are case-insensitive (3–32 letters, digits, or underscores); passwords require 12–128 characters. `GET /api/auth/me` returns the current user; `POST /api/auth/logout` revokes the session.

Passwords are salted and hashed with scrypt. Seven-day sessions are stored in PostgreSQL; only a hash of each random session token is stored. The browser receives an HttpOnly, SameSite=Strict cookie. Recipe and account mutations require `Content-Type: application/json`, including logout and deletion. Image uploads use their image MIME type. Reading recipes is public, and each record includes an `author` username. Creating recipes requires a session; attribution comes from the signed-in account rather than submitted recipe fields. Updates and deletions enforce ownership in SQL; other users’ recipes return 404. Registration is open, so this blocks anonymous submissions rather than restricting contributions to approved members.

Existing recipes without an owner remain publicly visible as “Unknown contributor” and cannot be edited or deleted through the API. Assign them deliberately with an administrative database migration if needed; registering an account does not claim existing recipes.

Authentication attempts are limited per IP in each server process. For public deployment, use HTTPS and `NODE_ENV=production` for Secure cookies, and configure shared rate limiting if running multiple instances. The app binds to localhost by default; configure `HOST` and `PORT` for your environment. Account recovery is not implemented. Google Fonts are optional; local fallback fonts work offline.
