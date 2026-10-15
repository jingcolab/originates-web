PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, github_id TEXT NOT NULL UNIQUE, github_login TEXT NOT NULL, email TEXT, name TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS oauth_states (hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS oauth_states_expiry ON oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, resets INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(resets);

/* Additive migration: existing GitHub identities and sessions are preserved. */
CREATE TABLE IF NOT EXISTS email_accounts(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS passkeys(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,public_key TEXT NOT NULL,counter INTEGER NOT NULL,transports TEXT NOT NULL,rp_id TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS passkeys_account ON passkeys(account_id,rp_id);
CREATE TABLE IF NOT EXISTS email_sessions(hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS email_sessions_expiry ON email_sessions(expires_at);
CREATE TABLE IF NOT EXISTS webauthn_challenges(hash TEXT PRIMARY KEY,challenge TEXT NOT NULL,email TEXT NOT NULL,account_id TEXT,flow TEXT NOT NULL,rp_id TEXT NOT NULL,origin TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS webauthn_challenges_expiry ON webauthn_challenges(expires_at);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL,status TEXT NOT NULL,notes TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id,updated_at);
