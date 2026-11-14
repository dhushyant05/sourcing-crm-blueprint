-- Up Migration
-- Kind on public quote attachments (photo, invoice, packing list) so invoices can stay India-only.
ALTER TABLE lead_media ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE shipping_request_files ADD COLUMN IF NOT EXISTS kind text;

-- Down Migration
ALTER TABLE shipping_request_files DROP COLUMN IF EXISTS kind;
ALTER TABLE lead_media DROP COLUMN IF EXISTS kind;
