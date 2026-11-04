-- Up Migration
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  prev_hash TEXT,
  token_version INTEGER NOT NULL,
  device TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX refresh_tokens_user ON refresh_tokens (user_id);

-- Down Migration
DROP TABLE refresh_tokens;
