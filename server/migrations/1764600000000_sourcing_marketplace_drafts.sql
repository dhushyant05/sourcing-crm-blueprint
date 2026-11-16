-- Link unpublished catalog drafts to the China quote that created them.
-- One product per quote. Factory/reference cost stays on these columns (staff only).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS source_lead_id text REFERENCES leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_quote_id text REFERENCES quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_lead_ref text,
  ADD COLUMN IF NOT EXISTS source_unit_price numeric(18,6),
  ADD COLUMN IF NOT EXISTS source_currency text,
  ADD COLUMN IF NOT EXISTS source_team_edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_update_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_discarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_discarded_by text REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS products_source_quote_uidx ON products (source_quote_id) WHERE source_quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_source_lead_idx ON products (source_lead_id) WHERE source_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_source_review_idx ON products (source_quote_id) WHERE source_quote_id IS NOT NULL AND source_discarded_at IS NULL AND deleted_at IS NULL;
