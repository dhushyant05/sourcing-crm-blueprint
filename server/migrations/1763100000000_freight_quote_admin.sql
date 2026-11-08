-- Up Migration
-- Super-admin freight-quote controls: soft delete (kept for audit/timeline, hidden from lists/PDFs) and immutable edit revisions.
ALTER TABLE freight_quotes ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by text,
  ADD COLUMN IF NOT EXISTS delete_reason text, ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS freight_quote_revisions (
  id bigserial PRIMARY KEY, quote_id text NOT NULL REFERENCES freight_quotes(id) ON DELETE CASCADE, revision integer NOT NULL,
  snapshot jsonb NOT NULL, action text NOT NULL, reason text, by_user text, at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS freight_quote_revisions_quote ON freight_quote_revisions (quote_id, id);

-- Down Migration
DROP TABLE IF EXISTS freight_quote_revisions;
ALTER TABLE freight_quotes DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS delete_reason, DROP COLUMN IF EXISTS revision;
