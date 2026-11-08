-- Up Migration
-- Shipping Request SLA (same clock settings as leads): runs while India owes the customer a response (SUBMITTED / UNDER_REVIEW).
ALTER TABLE shipping_requests ADD COLUMN IF NOT EXISTS sla_started_at timestamptz, ADD COLUMN IF NOT EXISTS sla_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_warned boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS sla_breached boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS shipping_sla_runs (
  id text PRIMARY KEY, request_id text NOT NULL REFERENCES shipping_requests(id) ON DELETE CASCADE, assignee text,
  started_at timestamptz NOT NULL, due_at timestamptz NOT NULL, ended_at timestamptz NOT NULL, breached boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS shipping_requests_sla_due ON shipping_requests (sla_due_at) WHERE sla_due_at IS NOT NULL;

-- Down Migration
DROP TABLE IF EXISTS shipping_sla_runs;
DROP INDEX IF EXISTS shipping_requests_sla_due;
ALTER TABLE shipping_requests DROP COLUMN IF EXISTS sla_started_at, DROP COLUMN IF EXISTS sla_due_at, DROP COLUMN IF EXISTS sla_warned, DROP COLUMN IF EXISTS sla_breached;
