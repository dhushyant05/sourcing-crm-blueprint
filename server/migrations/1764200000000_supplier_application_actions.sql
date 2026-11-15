-- Up Migration
-- Split account approval from the public verified badge, rename rejected to declined,
-- and record Marketplace Team / super-admin actions on supplier applications.

UPDATE supplier_profiles SET status = 'APPROVED' WHERE status = 'VERIFIED';
UPDATE supplier_profiles SET status = 'DECLINED' WHERE status = 'REJECTED';

CREATE TABLE IF NOT EXISTS supplier_application_audit (
  id bigserial PRIMARY KEY,
  profile_id text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  by_user text,
  action text NOT NULL,
  before jsonb,
  after jsonb
);
CREATE INDEX IF NOT EXISTS supplier_application_audit_profile ON supplier_application_audit (profile_id, id DESC);

-- Down Migration
DROP INDEX IF EXISTS supplier_application_audit_profile;
DROP TABLE IF EXISTS supplier_application_audit;
UPDATE supplier_profiles SET status = 'VERIFIED' WHERE status = 'APPROVED';
UPDATE supplier_profiles SET status = 'REJECTED' WHERE status = 'DECLINED';
