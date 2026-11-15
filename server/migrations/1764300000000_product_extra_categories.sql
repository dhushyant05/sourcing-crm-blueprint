-- Up Migration
-- A product has one primary category (products.category_id, used for the breadcrumb)
-- and may also appear in extra categories when browsing the catalog.

CREATE TABLE IF NOT EXISTS product_categories (
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id text NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);
CREATE INDEX IF NOT EXISTS product_categories_category ON product_categories (category_id);

-- Down Migration
DROP INDEX IF EXISTS product_categories_category;
DROP TABLE IF EXISTS product_categories;
