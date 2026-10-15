# Cloudflare account service

## Files

- `src/worker.mjs`: request routing, OAuth, sessions, security headers, scheduled cleanup.
- `public/`: homepage, login/account UI, JavaScript and CSS.
- `schema.sql`: idempotent D1 table/index creation (users, sessions, OAuth state, rate limits).
- `build.mjs`: deterministic asset packing; generates `src/assets.mjs` and standalone `dist/worker.mjs`.
- `wrangler.jsonc`: current account, D1 binding, public configuration and daily cleanup cron. No secret is committed.
- `test/auth.test.mjs`: 15 tests covering success, state mismatch/expiry/replay, provider failures, verified email selection, expiry, CSRF-safe logout, rate limits, protected routes and cleanup.

## Configuration

Use the Workers **Free** plan. D1 binding name must be `DB`. The existing database is `originates-db`; its ID and account are in `wrangler.jsonc`. Do not recreate the database during routine updates.

Public variables:

- `APP_ORIGIN=https://originates.dev`
- `PREVIEW_ORIGIN=https://originates-web.fucicbck.workers.dev`
- `GITHUB_CLIENT_ID`: public OAuth app client ID, configured in Wrangler.

Secret: `GITHUB_CLIENT_SECRET`. Store through Cloudflare's encrypted secrets UI or `wrangler secret put GITHUB_CLIENT_SECRET`; never commit it or put it in Pages/HTML/client JavaScript. OAuth app settings currently allow the two exact callback URLs below, with wildcard redirects and device flow disabled:

- `https://originates.dev/auth/github/callback`
- `https://originates-web.fucicbck.workers.dev/auth/github/callback`

The application requests only `read:user user:email`, not repository access. Callback state lives for ten minutes. Sign-in initiation is limited to 30 requests per 15-minute client-IP window. The IP is hashed before storage. This is a basic abuse limit, not comprehensive bot protection.

## Deploy

The current Worker was deployed and configured through Cloudflare's dashboard. For subsequent releases:

1. Run `npm test` under Node 24+ in this directory.
2. In the `originates-web` Worker editor, replace the complete code with the generated `dist/worker.mjs`. Deploy the latest version, preserving bindings and encrypted secrets.
3. Verify `/api/health`, signed-out `/app` redirection, a fresh real GitHub login, `/api/me`, and logout. Do not manually reuse or share OAuth callback URLs.
4. Check settings: D1 binding `DB`, both allowed origin variables, encrypted GitHub secret, daily cron `0 3 * * *` (UTC). Disable invocation logs to avoid retaining callback query parameters; this application deliberately logs no OAuth codes or tokens.

With an authenticated Wrangler CLI, the equivalent commands are `wrangler deploy` and (only when first initializing an empty database) `wrangler d1 execute originates-db --remote --file=schema.sql`. Run from this directory. Wrangler configuration disables observability logs. Source publishing and GitHub Actions tests do not automatically deploy the Worker; no Cloudflare deployment token is stored in GitHub.

## Routes

| Route | Behavior |
| --- | --- |
| `GET /` | Product-preview homepage |
| `GET /login` | GitHub sign-in |
| `GET /auth/github` | Create state/PKCE challenge and redirect to GitHub |
| `GET /auth/github/callback` | Validate/consume state, exchange code, save account and session |
| `GET /app` | Server-protected account page |
| `GET /api/me` | Current account, or 401 |
| `POST /api/logout` | Origin-checked session revocation |
| `GET /api/health` | Configuration/database readiness |

There is no CORS-based cross-domain credential API: users navigate to the Worker, and its UI/API share the same origin. Avoid cross-site fetch login or localStorage tokens. Sessions expire after seven days. Daily cron deletes expired sessions, OAuth state and rate-limit rows, but preserves accounts.

## Domain and rollback

GitHub Pages still serves `originates.dev`. Its login link uses the Worker URL. Do not move DNS or remove the Pages custom domain until the Cloudflare account controlling the domain is available and a same-domain Worker deployment can be verified. Both allowed origins and exact OAuth callbacks are preconfigured for that future change.

Keep the existing D1 database across Worker rollbacks. Use Cloudflare's deployment rollback to a known-good code version without dropping account/session tables. Pages can be rolled back independently through Git; its CNAME has not changed in this release.

## Limits and scope

The free plan has usage/CPU limits; it is not an unlimited-capacity or availability guarantee. Monitor usage in Cloudflare before inviting significant traffic. This OAuth service avoids password hashing and does not execute AI workflows or untrusted code. No payment, upgrade or paid feature was enabled. Keep GitHub app ownership, Cloudflare access and secrets protected; rotate the client secret if exposed.
