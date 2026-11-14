-- Up Migration
-- Product views, enquiry visitor keys, tags, and customer favourites for marketplace Phase 2.

ALTER TABLE products ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION products_search_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.specs::text, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.tags::text, '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_search_tsv_trg ON products;
CREATE TRIGGER products_search_tsv_trg BEFORE INSERT OR UPDATE OF title, summary, specs, tags ON products
  FOR EACH ROW EXECUTE PROCEDURE products_search_tsv_update();

UPDATE products p
SET tags = to_jsonb(ARRAY[lower(c.name)])
FROM categories c
WHERE c.id = p.category_id
  AND (p.tags IS NULL OR p.tags = '[]'::jsonb)
  AND p.deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS product_views (
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  visitor_key text NOT NULL,
  day date NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, visitor_key, day)
);
CREATE INDEX IF NOT EXISTS product_views_at ON product_views (product_id, at);

ALTER TABLE product_enquiries ADD COLUMN IF NOT EXISTS visitor_key text;
ALTER TABLE product_enquiries ADD COLUMN IF NOT EXISTS day date;
CREATE INDEX IF NOT EXISTS product_enquiries_at ON product_enquiries (product_id, at);

CREATE TABLE IF NOT EXISTS customer_favorites (
  customer_id text NOT NULL,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, product_id)
);
CREATE INDEX IF NOT EXISTS customer_favorites_customer ON customer_favorites (customer_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS customer_favorites;
DROP INDEX IF EXISTS product_enquiries_at;
ALTER TABLE product_enquiries DROP COLUMN IF EXISTS visitor_key;
ALTER TABLE product_enquiries DROP COLUMN IF EXISTS day;
DROP TABLE IF EXISTS product_views;
DROP TRIGGER IF EXISTS products_search_tsv_trg ON products;
CREATE OR REPLACE FUNCTION products_search_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.specs::text, '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER products_search_tsv_trg BEFORE INSERT OR UPDATE OF title, summary, specs ON products
  FOR EACH ROW EXECUTE PROCEDURE products_search_tsv_update();
ALTER TABLE products DROP COLUMN IF EXISTS tags;
