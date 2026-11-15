-- Up Migration
-- Manual clearance merchandising. A product is on clearance while clearance is true,
-- the optional end date has not passed, and optional stock-left is not zero.
-- Expired or sold-out rows stay in the catalog but drop out of the Clearance section.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS clearance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clearance_price numeric,
  ADD COLUMN IF NOT EXISTS clearance_discount_pct numeric,
  ADD COLUMN IF NOT EXISTS clearance_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS clearance_stock_left integer;

CREATE INDEX IF NOT EXISTS products_clearance_live
  ON products (published_at DESC)
  WHERE clearance = true AND deleted_at IS NULL AND status = 'PUBLISHED';

-- Down Migration
DROP INDEX IF EXISTS products_clearance_live;
ALTER TABLE products
  DROP COLUMN IF EXISTS clearance_stock_left,
  DROP COLUMN IF EXISTS clearance_ends_at,
  DROP COLUMN IF EXISTS clearance_discount_pct,
  DROP COLUMN IF EXISTS clearance_price,
  DROP COLUMN IF EXISTS clearance;
