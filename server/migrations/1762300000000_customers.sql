-- Up Migration
-- India-side customer directory (mirror of the China supplier directory). China never reads this table.
CREATE TABLE customers (
  id text PRIMARY KEY,
  name text NOT NULL,
  company text, phone text, whatsapp text, email text,
  city text, state text, country text, gst text, address text, notes text,
  tags text[] NOT NULL DEFAULT '{}',
  phone_key text, email_key text, company_key text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_phone_key ON customers (phone_key);
CREATE INDEX customers_email_key ON customers (email_key);
CREATE INDEX customers_company_key ON customers (company_key);
CREATE INDEX customers_name ON customers (lower(name));
ALTER TABLE leads ADD COLUMN customer_id text REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX leads_customer ON leads (customer_id);

-- Down Migration
ALTER TABLE leads DROP COLUMN customer_id;
DROP TABLE customers;
