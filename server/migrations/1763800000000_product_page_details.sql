-- Up Migration
-- Product-page merchandising details and public supplier card fields.
-- Existing categories already have parent_id; the original six remain top-level.

ALTER TABLE products ADD COLUMN IF NOT EXISTS capacity text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS packaging text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS customization text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sample_policy text;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS public_years integer;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS public_verified boolean NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE products
  DROP COLUMN IF EXISTS capacity,
  DROP COLUMN IF EXISTS packaging,
  DROP COLUMN IF EXISTS customization,
  DROP COLUMN IF EXISTS sample_policy;
ALTER TABLE suppliers
  DROP COLUMN IF EXISTS public_years,
  DROP COLUMN IF EXISTS public_verified;
