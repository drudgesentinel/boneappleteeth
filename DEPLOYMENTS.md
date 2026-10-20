# Deployment and implementation reference

See [README.md](README.md) for quick local setup and common commands.

## Run Hotdogcart with systemd

Use one application service: Express serves the built Svelte frontend from `dist/` and handles `/api` on the same port. Nginx handles public HTTPS and proxies to this service. Vite is a development server and does not run on the VPS. PostgreSQL and Nginx run as their own services.

### Prerequisites

- Node.js 24 installed system-wide as `/usr/bin/node`. If installed elsewhere, update `ExecStart` in the unit. A Node installation under `/root` is inaccessible with `ProtectHome=true`.
- The `hotdogcart` Linux user and group (already created on the VPS), without sudo or a login shell.
- Application files and installed dependencies under `/opt/hotdogcart`, owned by `root:hotdogcart`, with directories readable and traversable by the service group. The service has a read-only filesystem; uploads and recipes are stored in PostgreSQL.
- A running PostgreSQL database and a database role that can initialize the application's tables. `After=postgresql.service` orders startup after a local PostgreSQL service when present; it does not install or start PostgreSQL. The application retries failed startup every five seconds.

From the deployed application directory, install dependencies and build with Node.js 24 before starting the service:

```sh
cd /opt/hotdogcart
npm ci
npm run build
```

Build tools are needed during deployment, but are not run by the service. Run builds as an administrator or dedicated build user, then ensure `hotdogcart` has read access to the resulting files. The service uses Node directly so systemd sends shutdown signals to the application process.

### Configuration and installation

Create the configuration file on the VPS, keeping the real credentials out of this repository:

```sh
sudo install -d -o root -g hotdogcart -m 0750 /etc/hotdogcart
sudo install -o root -g hotdogcart -m 0640 /dev/null /etc/hotdogcart/hotdogcart.env
sudoedit /etc/hotdogcart/hotdogcart.env
```

Run the `install` command only when first creating the file: it empties an existing file. Set the connection string in it, with a URL-encoded password if needed:

```dotenv
DATABASE_URL=postgres://hotdogcart:REPLACE_WITH_REAL_PASSWORD@127.0.0.1:5432/hotdogcart
TRUST_PROXY=loopback
```

The unit supplies `NODE_ENV=production`, `HOST=127.0.0.1`, and `PORT=3000`. The environment file can override those values; retain loopback binding for the supplied Nginx setup. systemd reads the environment file, so the service does not need `/opt/hotdogcart/.env`.

From `/opt/hotdogcart`, install and start the unit:

```sh
sudo install -m 0644 deploy/systemd/hotdogcart.service /etc/systemd/system/hotdogcart.service
sudo systemd-analyze verify /etc/systemd/system/hotdogcart.service
sudo systemctl daemon-reload
sudo systemctl enable --now hotdogcart.service
sudo systemctl status hotdogcart.service
curl --fail http://127.0.0.1:3000/api/recipes
```

Configure [Nginx](#vps-deployment-with-nginx) after confirming local access. The current Nginx example uses `example.com`; substitute `hotdogcart.net` for the actual VPS domain, including certificate paths.

### Updates and logs

Deploy new files, run `npm ci` and `npm run build`, then restart the application. Stop it first if replacing files in place so requests do not read a mixture of old and new files:

```sh
sudo systemctl stop hotdogcart.service
cd /opt/hotdogcart
## Copy the new application files into this directory.
npm ci
npm run build
sudo systemctl start hotdogcart.service
sudo journalctl -u hotdogcart.service -n 100 --no-pager
```

Run `sudo systemctl restart hotdogcart.service` after changing environment values. Unit file changes also require reinstalling the unit and running `sudo systemctl daemon-reload`. Application output is captured by the system journal.

### Manage application accounts on the VPS

Once the service has initialized the database schema, use the same environment file for the account tools. These commands run with the service account's privileges and prompt for hidden passwords:

```sh
sudo -u hotdogcart /usr/bin/node --env-file=/etc/hotdogcart/hotdogcart.env /opt/hotdogcart/scripts/create-user.js alice
sudo -u hotdogcart /usr/bin/node --env-file=/etc/hotdogcart/hotdogcart.env /opt/hotdogcart/scripts/create-user.js --password alice
```

Password updates revoke existing sessions. These application accounts are separate from the Linux service account.

See the systemd references for [service lifecycle](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) and [execution settings](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html).

## Update helper

The server checkout uses the GitHub `origin` remote. Push local commits to GitHub before updating the VPS. The helper requires a clean checkout and a fast-forward update; it never resets or discards local work. It installs dependencies, runs tests, builds, reinstalls the systemd unit, and checks the local API. Configuration in `/etc/hotdogcart` and PostgreSQL data are retained. Nginx configuration changes require separate review and reload.

Run as root on the VPS:

```sh
cp /opt/hotdogcart/deploy/update.sh /tmp/hotdogcart-update.sh
bash /tmp/hotdogcart-update.sh
```

Copying the helper outside the checkout lets Git replace its source during an update. The service is stopped while files change. If installation, tests, build, or the health check fails, it remains stopped; inspect the error and `journalctl -u hotdogcart.service`, fix the problem, and rerun the helper. There is no automatic rollback. Use `git -C /opt/hotdogcart log -1` to inspect the deployed commit.

## VPS deployment with Nginx

[example.com.conf](deploy/nginx/example.com.conf) terminates HTTPS for `example.com`, redirects HTTP to HTTPS, and proxies the frontend and API to Express on `127.0.0.1:3000`. It allows the application's 5 MB image uploads. This example assumes Nginx and the application run directly on the same VPS; container networking requires different upstream and bind settings.

1. Point the domain's DNS at the VPS. Publish an AAAA record only if IPv6 is configured. Allow inbound TCP ports 80 and 443.
2. Configure the application's `.env` with `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=3000`, and the production `DATABASE_URL`. Keep PostgreSQL private. Install dependencies with Node.js 24, run `npm run build`, and run `npm start` under a process supervisor such as systemd. Express serves the compiled frontend; Vite is not needed in production.
3. Install Nginx and an ACME client such as Certbot. Create `/var/www/letsencrypt` and ensure Nginx can read it. Initially install **only the port 80 server block** in an Nginx configuration directory included inside the `http` block, such as `/etc/nginx/conf.d/`. The HTTPS block requires certificate files that do not exist yet. Check with `sudo nginx -t`, then reload Nginx.
4. With Certbot installed, request the certificate using the webroot served by the HTTP block:

   ```sh
   sudo certbot certonly --webroot -w /var/www/letsencrypt -d example.com
   ```

5. Install the complete example as `/etc/nginx/conf.d/example.com.conf` (or use your distribution's `sites-available`/`sites-enabled` convention). Remove any duplicate configuration for this domain. Verify the certificate paths match your ACME client's output, then validate and reload:

   ```sh
   sudo nginx -t
   sudo systemctl reload nginx
   ```

6. Enable the ACME client's renewal timer, arrange for Nginx to reload after successful renewal, and test renewal. For Certbot, run `sudo certbot renew --dry-run`. A Certbot deploy hook can run `systemctl reload nginx` after renewal.

Confirm `http://example.com` redirects to HTTPS, then check browsing, sign-in, and an image upload at `https://example.com`. Keep application port 3000 accessible only on loopback. No certificates or private keys belong in this repository.

### Client IP rate limiting

Set `TRUST_PROXY=loopback` in `/etc/hotdogcart/hotdogcart.env` when using the supplied Nginx configuration. Express then trusts forwarded client IPs only from loopback peers, allowing authentication rate limits to apply to each visitor. Nginx replaces incoming forwarded headers, and Express must remain bound to loopback. Leave this variable unset when exposing Express directly or using a different proxy topology.

### References

- [Nginx HTTPS configuration](https://nginx.org/en/docs/http/configuring_https_servers.html)
- [Nginx proxy headers and upstream configuration](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Nginx upload size limit](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)

## Application reference

### Local test account

Run `npm run seed:test-user` to create or reset username `foo` with password `bar` in the local database configured by `.env`. The command initializes missing database tables before seeding, so the app does not need to run first. This fixture is blocked for production and remote databases. New registrations still require at least 12 password characters; login accepts the short test password.

### Recipe format

```toml
title = "Tomato toast"
description = "A quick summer lunch."
servings = 1
minutes = 10
tags = ["lunch", "vegetarian"]
## Optional inspiration link:
## reference = "https://example.com/recipes/tomato-toast"
ingredients = ["1 slice sourdough", "1 ripe tomato", "Olive oil and salt"]
steps = ["Toast the bread.", "Slice the tomato, arrange on toast, and season."]
```

`title`, `ingredients`, and `steps` are required. Ingredients are strings or inline tables with `name`, optional `quantity`, and optional `cost`; `steps` contains the cooking instructions in order. Both arrays must contain at least one entry; ingredient names and instruction strings must be nonempty. The optional `reference` field is an absolute HTTP or HTTPS link to the inspiring recipe, displayed separately from contributor attribution. Omit it when there is no reference. `servings` and `minutes`, when supplied, must be positive integers. Additional metadata is retained when editing existing recipes; form saves regenerate TOML formatting and remove TOML comments. Documents are limited to 100 KB.

#### Ingredient costs

Use an inline table for each ingredient that has a quantity or cost. Quantity accepts nonempty text such as `"200 g"`, `"1/2 cup"`, or `"to taste"`, or a nonnegative number. The editor has separate ingredient name and quantity fields; legacy strings remain supported. Cost may be an amount for the quantity used or text such as `"1.99/pound"`; no conversion or total is calculated.

```toml
ingredients = [
  { name = "spaghetti", quantity = "200 g", cost = { amount = 1.20, currency = "USD" } },
  { name = "1 lemon", cost = { amount = 0.60, currency = "USD" } },
  "Salt and pepper", # cost can be omitted
]
```

Plain strings remain supported, and both forms can be mixed. Each supplied ingredient cost requires a nonnegative numeric amount or nonempty text (for example `"1.99/pound"`), plus a currency. Costs are displayed as entered. Total recipe cost is supplied separately by the user; ingredient costs are never automatically totaled. All costs in a recipe must use the same currency. Ingredient costs appear beside their ingredients and are searchable by ingredient name. The optional recipe total is entered by the user and may also contain text.

#### Optional images, nutrition, and cost

Use the editor’s image picker to upload a PNG, JPEG, or WebP file (maximum 5 MB). Images are stored in PostgreSQL and referenced by a root-level `image` path. Image upload requires sign-in; recipes can only reference images uploaded by their author. Images are publicly readable. Removing or replacing an image reference does not delete its stored bytes; canceled uploads are retained for now.

Place root-level fields before TOML table headers:

```toml
## Alongside title, ingredients, steps, and reference:
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

### Structure and API

- `src/client/`: Svelte interface and responsive styles.
- `src/server/`: Express routes, database initialization, and TOML validation.
- `tests/`: validation and HTTP API tests.

`GET /api/recipes` lists recipes. `POST /api/recipes` creates one; `PUT /api/recipes/:id` updates it. Both writes accept JSON `{ "recipe": { "title": "Toast", "ingredients": ["Bread"], "steps": ["Toast the bread."] } }`; the backend serializes and validates TOML before storing it. Legacy JSON `{ "toml": "..." }` requests remain supported and retain their original document formatting. `DELETE /api/recipes/:id` deletes one. Records include their ID, original TOML, parsed recipe, and timestamps. Search runs locally across titles, descriptions, tags, and ingredients.

### Accounts and access

`POST /api/auth/register` and `POST /api/auth/login` accept JSON `{ "username": "sean", "password": "a-long-unique-password" }`. Usernames are case-insensitive (3–32 letters, digits, or underscores); passwords require 12–128 characters. `GET /api/auth/me` returns the current user; `POST /api/auth/logout` revokes the session.

Passwords are salted and hashed with scrypt. Seven-day sessions are stored in PostgreSQL; only a hash of each random session token is stored. The browser receives an HttpOnly, SameSite=Strict cookie. Recipe and account mutations require `Content-Type: application/json`, including logout and deletion. Image uploads use their image MIME type. Reading recipes is public, and each record includes an `author` username. Creating recipes requires a session; attribution comes from the signed-in account rather than submitted recipe fields. Updates and deletions enforce ownership in SQL; other users’ recipes return 404. Registration is open, so this blocks anonymous submissions rather than restricting contributions to approved members.

Existing recipes without an owner remain publicly visible as “Unknown contributor” and cannot be edited or deleted through the API. Assign them deliberately with an administrative database migration if needed; registering an account does not claim existing recipes.

Authentication attempts are limited per IP in each server process. For public deployment, use HTTPS and `NODE_ENV=production` for Secure cookies, and configure shared rate limiting if running multiple instances. The app binds to localhost by default; configure `HOST` and `PORT` for your environment. Account recovery is not implemented. Google Fonts are optional; local fallback fonts work offline.

### Manually manage application accounts

Run `npm run user:create -- alice` from the application directory with Node.js 24. The utility reads `DATABASE_URL` from the environment or `.env` and prompts for a hidden password and confirmation. Usernames and passwords follow the registration rules. It inserts a new account with the application's scrypt password hashing; duplicate usernames fail without changing existing accounts. The database schema must already be initialized by the application. This creates an application login, not a Linux account.

Create an account named `alice`:

```sh
npm run user:create -- alice
```

Enter and confirm a password when prompted (12–128 characters). To update that account's password later:

```sh
npm run user:password -- alice
```

Enter and confirm the new password. Updating a password revokes all existing sessions for that account, requiring the user to sign in again. A missing username fails without creating an account. Both commands hide password input and accept passwords through standard input for automation.

For automation, supply the password through standard input from a secret manager. Do not put passwords in command arguments or shell history. The command requires database write access and never prints the password or hash.
