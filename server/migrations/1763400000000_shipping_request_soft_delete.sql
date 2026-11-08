-- Up Migration
-- Super-admin soft delete of a shipping request: the row, events, quotes and files stay (audit/history); every
-- staff/customer/China read path filters deleted_at IS NULL. The one-active-request-per-order index ignores deleted rows.
ALTER TABLE shipping_requests ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by text, ADD COLUMN IF NOT EXISTS delete_reason text;
DROP INDEX IF EXISTS shipping_requests_order;
CREATE UNIQUE INDEX shipping_requests_order ON shipping_requests (order_id) WHERE order_id IS NOT NULL AND status NOT IN ('REJECTED','CANCELLED') AND deleted_at IS NULL;

-- Down Migration
DROP INDEX IF EXISTS shipping_requests_order;
CREATE UNIQUE INDEX shipping_requests_order ON shipping_requests (order_id) WHERE order_id IS NOT NULL AND status NOT IN ('REJECTED','CANCELLED');
ALTER TABLE shipping_requests DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS delete_reason;
