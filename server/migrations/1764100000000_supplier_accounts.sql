-- Up Migration
-- Supplier self-signup: a SUPPLIER login linked to a catalog supplier card, pending verification.

CREATE TABLE IF NOT EXISTS supplier_profiles (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  supplier_id text NOT NULL UNIQUE REFERENCES suppliers(id) ON DELETE RESTRICT,
  company text NOT NULL,
  contact_name text NOT NULL,
  phone text,
  email text,
  status text NOT NULL DEFAULT 'PENDING',
  reject_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_profiles_status ON supplier_profiles (status);

-- Down Migration
DROP INDEX IF EXISTS supplier_profiles_status;
DROP TABLE IF EXISTS supplier_profiles;
