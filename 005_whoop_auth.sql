-- 005_whoop_auth.sql
-- Store the rotating WHOOP refresh token in the database so both the laptop and
-- GitHub Actions runs share a single source of truth. WHOOP issues a new
-- refresh_token on every refresh; we persist it here after each call.

CREATE TABLE IF NOT EXISTS whoop_auth (
    id              INTEGER PRIMARY KEY DEFAULT 1,
    refresh_token   TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT whoop_auth_singleton CHECK (id = 1)
);
