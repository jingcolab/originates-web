# Robotics workspace on Cloudflare Workers Free + D1

## Build and test

```sh
npm ci
npm test
```

Node.js 24+. The pinned SimpleWebAuthn libraries implement registration/authentication verification and browser credential serialization. `esbuild` bundles the browser script and standalone Worker. Build output includes only public assets and code, never secrets. Versions and dependency integrity hashes are locked in `package-lock.json`.

- `src/worker.mjs`: allowed origins, existing GitHub OAuth, account/session reads, headers and cleanup.
- `src/passkeys.mjs`: WebAuthn registration and login; email normalization; browser-bound single-use ten-minute challenges; required user verification; RP/origin binding; public-key credential storage.
- `src/projects.mjs`: per-account project CRUD, validation and 50-project quota.
- `public/`: English robotics website, account UI, local prompt builder, Markdown exporter and concept image.
- `schema.sql`: additive CREATE IF NOT EXISTS schema. It preserves existing GitHub users/sessions and adds email accounts, passkeys, email sessions, WebAuthn challenges and projects.
- `dist/worker.mjs`: generated standalone deployment bundle. `src/assets.mjs` and `public/auth.js` are generated too.

## Configuration

Keep Workers **Free**. Existing D1 `originates-db` is bound as `DB`. Account/database IDs and public variables are in `wrangler.jsonc`:

- `APP_ORIGIN=https://originates.dev`
- `PREVIEW_ORIGIN=https://originates-web.fucicbck.workers.dev`
- `GITHUB_CLIENT_ID`: public ID.

`GITHUB_CLIENT_SECRET` must stay an encrypted Cloudflare secret, never in Git, HTML or frontend JavaScript. Exact GitHub OAuth callbacks remain `/auth/github/callback` on both configured origins. GitHub tokens are not stored; scopes remain `read:user user:email`.

Passkey registration works without a mail provider, a password or GitHub. The browser must support WebAuthn and the user must confirm their device's passkey UI. Server verification requires user presence/verification and the exact current origin/RP ID. Attestation is not requested, and the server stores public keys, never a biometric or private key. Email addresses are **unverified identifiers**, not identity claims. Email registration does not grant access to a GitHub account with the same email. There is no email recovery/reset service. Protect/sync passkeys. Origin changes cannot automatically move existing credentials.

## Deployment

1. Run `npm ci && npm test`.
2. For a new installation or this additive schema upgrade, run `schema.sql` in the D1 dashboard console, or use authenticated `wrangler d1 execute originates-db --remote --file=schema.sql`. Do not drop or recreate existing tables.
3. Replace the latest editable Worker's code with `dist/worker.mjs` in the Cloudflare editor, then deploy. Preserve bindings and encrypted secrets. Authenticated Wrangler users may alternatively run `wrangler deploy` from this directory.
4. Check `/api/health`, signed-out `/app`, a fresh passkey registration/login, existing GitHub login, project ownership, save/reload/delete and logout. Tests must not bypass the production verifier.
5. Keep daily cron `0 3 * * *` UTC. It removes expired OAuth/passkey challenges, rate limits and both kinds of sessions, not accounts/projects. Disable invocation logs so OAuth callback query parameters are not retained. This application logs no credential payloads, codes, tokens or project notes.

Source publishing and GitHub Actions tests do not automatically deploy this Worker. No Cloudflare deployment token is kept in GitHub. Monitor Free usage limits; this is not an unlimited-capacity or availability guarantee.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Readiness/build |
| `GET /auth/github` / callback | Existing GitHub OAuth |
| `POST /api/passkey/options` | `{email, mode: "register" or "login"}` → credential options |
| `POST /api/passkey/verify` | `{credential}` + HttpOnly challenge cookie → account/session |
| `GET /api/me` | Current account and authentication method; 401 if signed out |
| `POST /api/logout` | Revoke the current session |
| `GET /api/projects` | Only current user's projects |
| `GET /api/projects/:id/export` | Authenticated Markdown attachment, owned project only |
| `POST /api/projects` | Create validated project |
| `PUT /api/projects/:id` | Update only an owned project |
| `DELETE /api/projects/:id` | Delete only an owned project |

Mutations require the same Origin. No cross-origin credential API is provided. Sessions are random 256-bit tokens stored only as SHA-256 hashes. Cookies are Secure, HttpOnly, SameSite=Lax and host-only. Limits: 30 passkey option requests per client-IP window of 15 minutes; basic abuse protection, not comprehensive bot defense. Project name ≤80 characters, notes ≤8000 characters, 50 projects per account. Do not store secrets or sensitive data.

## Rollback and domain

Roll back Worker code using Cloudflare's deployment history, retaining the additive database tables and user data. Pages can be rolled back independently. Do not remove Pages' CNAME or change DNS until the account owning the domain is available. Keep the current Worker hostname accessible for passkeys enrolled there; a future same-domain migration needs authenticated passkey re-enrollment or explicit cross-origin account linking, not just a redirect.
