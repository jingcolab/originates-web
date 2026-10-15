# Originates · Robotics & Embodied AI

A Chinese-language developer site for **physical robotics and embodied AI**, with a real project notebook on **Cloudflare Workers Free + D1**. No Supabase, paid Worker upgrade, model charges, or hardware connection is enabled.

- Website: https://originates.dev (GitHub Pages)
- Login / email registration: https://originates-web.fucicbck.workers.dev/login
- Project workspace: https://originates-web.fucicbck.workers.dev/app

## Available now

- Robotics-focused homepage: perception, planning, control, and links to official ROS 2 / Gazebo / MoveIt documentation. The robot photo is an AI-generated concept illustration, not a company product or lab claim.
- Registration using any supported-format email address, with a **WebAuthn passkey** (device fingerprint, face, screen lock or security key). No GitHub account or password is required.
- Existing GitHub OAuth login retained with S256 PKCE, browser-bound single-use state, minimal profile/email scopes and no repository access.
- Secure seven-day sessions, server-side logout revocation, origin checks, basic rate limits and daily expired-record cleanup.
- Per-user robotics projects: create, list, edit, delete; platform/direction, stage and development notes; maximum 50 projects per account. Markdown export and a local AI-collaboration prompt template.

**Email ownership is not verified.** Email is an account identifier, not proof of identity. No verification email, password, email recovery or automatic account linking is offered. Keep/sync your passkey; its origin is the Worker host where it was registered. GitHub and email accounts remain separate even if their email strings match. Passkeys do not silently migrate to a different domain. Changing account domains requires a separate credential migration/re-enrollment design.

No simulation, remote hardware control, AI model execution, robot deployment, model training, billing or paid plans are implemented. Generated prompt text is not an AI inference result. Review all code and use appropriate safety procedures before working with real hardware.

## Development

```sh
cd cloudflare
npm ci
npm test
```

Node.js 24+ is required. There are 27 automated unit/integration tests, including OAuth, passkey challenge binding/expiry/replay, invalid credentials, origin/CSRF protection, project ownership, quotas, logout and cleanup. Some tests inject a mock WebAuthn verifier to isolate persistence paths; a separate test uses the actual verifier to reject fabricated credentials. Separate live protocol tests use dedicated synthetic P-256 test keys and real production verification for registration and signed authentication. The system biometric/passkey dialog must be tested on the user’s own supported device; the shared browser cannot complete that native UI. No end-user biometric data is collected or stored.

See [cloudflare/README.md](cloudflare/README.md) for configuration, deployment, schema and rollback.

## Hosting boundary

The homepage remains on GitHub Pages and links to the Worker account site. `/login/` and `/app/` forward there. The Pages CNAME is preserved: the Cloudflare account used for this Worker does not contain the `originates.dev` zone. No DNS transfer was performed. GitHub source updates run tests and publish Pages, but do not automatically deploy the Worker.
