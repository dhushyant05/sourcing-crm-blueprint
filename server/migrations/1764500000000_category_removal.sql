-- Up Migration
-- Audit trail for category deactivate / reactivate / reassign / delete and extra-link removal.

CREATE TABLE IF NOT EXISTS category_audit (
  id bigserial PRIMARY KEY,
  category_id text,
  at timestamptz NOT NULL DEFAULT now(),
  by_user text,
  action text NOT NULL,
  before jsonb,
  after jsonb
);
CREATE INDEX IF NOT EXISTS category_audit_category ON category_audit (category_id, id DESC);

-- Down Migration
DROP INDEX IF EXISTS category_audit_category;
DROP TABLE IF EXISTS category_audit;
