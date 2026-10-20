# VPS deployment with Nginx

[example.com.conf](example.com.conf) terminates HTTPS for `example.com`, redirects HTTP to HTTPS, and proxies the frontend and API to Express on `127.0.0.1:3000`. It allows the application's 5 MB image uploads. This example assumes Nginx and the application run directly on the same VPS; container networking requires different upstream and bind settings.

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

## Client IP rate limiting

The current Express app does not enable `trust proxy`. Its authentication limiter therefore sees the Nginx loopback address, so all visitors share one rate-limit bucket. The example forwards client IP headers, but using them requires an application change to trust only the local proxy (for example `app.set('trust proxy', 'loopback')` before installing authentication middleware). Keep the upstream private and account for this before public deployment. This configuration does not change application code.

## References

- [Nginx HTTPS configuration](https://nginx.org/en/docs/http/configuring_https_servers.html)
- [Nginx proxy headers and upstream configuration](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Nginx upload size limit](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)
