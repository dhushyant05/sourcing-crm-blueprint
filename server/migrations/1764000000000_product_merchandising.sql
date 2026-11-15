-- Up Migration
-- Extra merchandising fields for an Alibaba-style product page (variations, lead-time
-- table, packing metrics, sample price, shipping estimate, Source Easy protections).
-- Selling prices stay in existing price columns / product_price_tiers. Factory cost is never stored here.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS merchandising jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Down Migration
ALTER TABLE products DROP COLUMN IF EXISTS merchandising;
