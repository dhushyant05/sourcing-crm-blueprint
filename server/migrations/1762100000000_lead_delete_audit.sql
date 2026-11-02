-- Up Migration
CREATE TABLE lead_delete_audit (
  id BIGSERIAL PRIMARY KEY,
  lead_id TEXT NOT NULL,
  lead_ref TEXT,
  product TEXT,
  client_name TEXT,
  had_orders INTEGER NOT NULL DEFAULT 0,
  active_orders INTEGER NOT NULL DEFAULT 0,
  forced BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_by TEXT,
  deleted_by_name TEXT,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lead_delete_audit_at ON lead_delete_audit (deleted_at DESC);
-- Down Migration
DROP TABLE lead_delete_audit;
