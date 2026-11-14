-- Up Migration
-- Phase 1 catalog / marketplace. Homepage flag defaults off. Sample products are not inserted here;
-- super admin seeds them with an explicit action. Supplier consent and membership tables are prepared
-- for Phase 2 and must not be exposed on public APIs in this release.
-- pg_trgm is optional (available on the VPS, not in PGlite tests).

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS catalog_product_id text;

CREATE TABLE IF NOT EXISTS catalog_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO catalog_settings (key, value) VALUES
  ('homepage_enabled', 'false'::jsonb),
  ('banner_direction', '"LTR"'::jsonb),
  ('banner_interval_seconds', '5'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS fx_rates (
  base text NOT NULL,
  quote text NOT NULL,
  rate numeric(18,8) NOT NULL,
  as_of timestamptz NOT NULL DEFAULT now(),
  set_by text,
  PRIMARY KEY (base, quote)
);

CREATE TABLE IF NOT EXISTS categories (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  parent_id text REFERENCES categories(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS categories_name_lc ON categories (lower(name));

CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text,
  specs jsonb,
  category_id text REFERENCES categories(id),
  supplier_id text,
  status text NOT NULL DEFAULT 'DRAFT',
  moq numeric,
  unit text,
  lead_time text,
  price_mode text NOT NULL DEFAULT 'GET_QUOTE',
  base_currency text NOT NULL DEFAULT 'USD',
  price_min numeric(18,6),
  price_max numeric(18,6),
  price_usd numeric(18,6),
  price_cny numeric(18,6),
  price_inr numeric(18,6),
  pinned boolean NOT NULL DEFAULT false,
  pin_starts_at timestamptz,
  pin_ends_at timestamptz,
  is_sample boolean NOT NULL DEFAULT false,
  search_tsv tsvector,
  created_by text,
  approved_by text,
  published_at timestamptz,
  deleted_at timestamptz,
  deleted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_status ON products (status);
CREATE INDEX IF NOT EXISTS products_category ON products (category_id);
CREATE INDEX IF NOT EXISTS products_published ON products (status, deleted_at) WHERE status = 'PUBLISHED' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS products_sample ON products (is_sample) WHERE is_sample;
CREATE INDEX IF NOT EXISTS products_search_tsv ON products USING gin (search_tsv);

CREATE OR REPLACE FUNCTION products_search_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.specs::text, '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_search_tsv_trg ON products;
CREATE TRIGGER products_search_tsv_trg BEFORE INSERT OR UPDATE OF title, summary, specs ON products
  FOR EACH ROW EXECUTE PROCEDURE products_search_tsv_update();

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS products_title_trgm ON products USING gin (title gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS product_images (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file_id text NOT NULL,
  kind text NOT NULL DEFAULT 'ORIGINAL',
  sort integer NOT NULL DEFAULT 0,
  alt_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_images_product ON product_images (product_id, sort);

CREATE TABLE IF NOT EXISTS product_price_tiers (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  min_qty numeric NOT NULL,
  max_qty numeric,
  unit_price numeric(18,6) NOT NULL,
  price_usd numeric(18,6),
  price_cny numeric(18,6),
  price_inr numeric(18,6)
);
CREATE INDEX IF NOT EXISTS product_price_tiers_product ON product_price_tiers (product_id, min_qty);

CREATE TABLE IF NOT EXISTS product_audit (
  id bigserial PRIMARY KEY,
  product_id text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  by_user text,
  action text NOT NULL,
  before jsonb,
  after jsonb
);
CREATE INDEX IF NOT EXISTS product_audit_product ON product_audit (product_id, id DESC);

CREATE TABLE IF NOT EXISTS product_enquiries (
  id text PRIMARY KEY,
  product_id text NOT NULL,
  lead_id text,
  customer_id text,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS banner_slides (
  id text PRIMARY KEY,
  sort integer NOT NULL DEFAULT 0,
  file_id text,
  mobile_file_id text,
  alt_text text NOT NULL,
  link_kind text NOT NULL DEFAULT 'NONE',
  product_id text,
  category_id text,
  url text,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  is_sample boolean NOT NULL DEFAULT false,
  greeting_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Phase 2 preparation only: never returned by public catalog APIs in Phase 1.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS catalog_consent boolean NOT NULL DEFAULT false;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS consent_at timestamptz;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS consent_by text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS consent_notes text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS public_region text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS public_about text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS show_contacts_to_members boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS membership_plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  duration_days integer,
  price numeric(18,6),
  currency text,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS memberships (
  id text PRIMARY KEY,
  customer_id text NOT NULL,
  plan_id text REFERENCES membership_plans(id),
  status text NOT NULL DEFAULT 'ACTIVE',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  activated_by text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS membership_plans;
ALTER TABLE suppliers DROP COLUMN IF EXISTS catalog_consent, DROP COLUMN IF EXISTS consent_at, DROP COLUMN IF EXISTS consent_by,
  DROP COLUMN IF EXISTS consent_notes, DROP COLUMN IF EXISTS public_region, DROP COLUMN IF EXISTS public_about,
  DROP COLUMN IF EXISTS show_contacts_to_members;
DROP TABLE IF EXISTS banner_slides;
DROP TABLE IF EXISTS product_enquiries;
DROP TABLE IF EXISTS product_audit;
DROP TABLE IF EXISTS product_price_tiers;
DROP TABLE IF EXISTS product_images;
DROP TRIGGER IF EXISTS products_search_tsv_trg ON products;
DROP FUNCTION IF EXISTS products_search_tsv_update();
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS fx_rates;
DROP TABLE IF EXISTS catalog_settings;
ALTER TABLE leads DROP COLUMN IF EXISTS catalog_product_id;
