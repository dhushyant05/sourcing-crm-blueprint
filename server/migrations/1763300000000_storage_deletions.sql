-- Up Migration
-- Storage Manager: permanent audit of every file removed by the super admin (metadata only; the bytes are gone).
CREATE TABLE IF NOT EXISTS storage_deletions (
  id bigserial PRIMARY KEY, owner_key text NOT NULL, file_id text NOT NULL, name text, mime text, size bigint,
  places jsonb NOT NULL DEFAULT '[]', by_user text, reason text, at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE IF EXISTS storage_deletions;
