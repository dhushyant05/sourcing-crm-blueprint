-- Up Migration
CREATE TABLE device_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_user ON device_tokens (user_id);

-- Down Migration
DROP TABLE device_tokens;
