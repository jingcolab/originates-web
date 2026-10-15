# Originates Web

Public landing page with real GitHub account sign-in on **Cloudflare Workers Free + D1**. No Supabase or paid Workers subscription is used.

- Homepage: https://originates.dev (GitHub Pages)
- Sign in: https://originates-web.fucicbck.workers.dev/login
- Protected account: https://originates-web.fucicbck.workers.dev/app
- Health: https://originates-web.fucicbck.workers.dev/api/health

The homepage links to the Worker. `/login/` and `/app/` on Pages forward to that host. Account cookies belong to the Worker host, not GitHub Pages. The custom domain has **not** been migrated: `originates.dev` is not present in the Cloudflare account used for this deployment. Domain ownership/access must be resolved before adding its Worker custom domain; the Pages `CNAME` is intentionally preserved.

## Implemented

GitHub OAuth authorization-code sign-in with S256 PKCE and browser-bound, single-use expiring state; first sign-in creates a D1 account. Sessions are persisted as SHA-256 hashes, use Secure/HttpOnly/SameSite=Lax cookies, expire after seven days, and are revoked on logout. Only GitHub profile and email scopes are requested. GitHub tokens are never persisted. Origin checks, login rate limiting, security headers, and daily expired-record cleanup are included.

This release does **not** implement AI workflow execution, cloud sandboxes, billing, paid plans, team permissions, a public API-key system, email/password registration, or password recovery. Marketing features and performance numbers on the landing page describe the product vision, not verified services or guarantees. The earlier Node email/password prototype is kept on `fix/account-login`; it is not the deployed Worker.

## Development and deployment

See [cloudflare/README.md](cloudflare/README.md) for schema, configuration, endpoints, testing, deployment and rollback. The Worker has no npm runtime dependencies.

```sh
cd cloudflare
npm test
```

Node.js 24 or newer is required. Tests use in-memory SQLite and a mocked GitHub provider; they do not contact live GitHub. Live GitHub sign-in and logout were separately verified against the deployed Worker.
