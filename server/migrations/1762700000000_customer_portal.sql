-- Up Migration
-- Customer portal, phase 1: a separate customer login realm (never in `users`), manual login requests, customer-visible events.
CREATE TABLE customer_users (
  id text PRIMARY KEY,
  customer_id text NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE, -- one login per customer (for now)
  phone text NOT NULL,
  phone_key text NOT NULL UNIQUE,                                              -- login ID: digits, unique across all portal logins
  name text NOT NULL,
  email text,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  token_version integer NOT NULL DEFAULT 0,
  last_login_at timestamptz,
  issued_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE portal_login_requests (
  id text PRIMARY KEY,
  lead_id text REFERENCES leads(id) ON DELETE SET NULL,
  name text NOT NULL,
  phone text NOT NULL,
  phone_key text NOT NULL,
  email text,
  company text,
  status text NOT NULL DEFAULT 'PENDING',                                     -- PENDING | APPROVED | REJECTED
  reason text,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portal_login_requests_status ON portal_login_requests (status, created_at);
CREATE TABLE portal_audit (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id text, actor_kind text NOT NULL,                                    -- STAFF | CUSTOMER | PUBLIC
  action text NOT NULL, subject text, detail jsonb NOT NULL DEFAULT '{}'
);
-- Events are internal unless explicitly customer-visible; the customer sees only `customer_text`, never `data`.
ALTER TABLE lead_events ADD COLUMN customer_visible boolean NOT NULL DEFAULT false;
ALTER TABLE lead_events ADD COLUMN customer_text text;
UPDATE lead_events SET customer_visible = true
  WHERE kind IN ('CREATED','CQ_SENT','CQ_ACCEPTED','CQ_REJECTED','CQ_REVERTED','ORDER_CREATED','ORDER_CANCELLED','SHIPPED','COMPLETED','LEAD_CLOSED','CLOSED_PERMANENT');
ALTER TABLE leads ADD COLUMN portal_user_id text;
-- Lead files the customer uploaded through the portal (the only lead files a customer can list or download).
CREATE TABLE portal_files (lead_id text NOT NULL, file_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (lead_id, file_id));

-- Down Migration
DROP TABLE portal_files;
ALTER TABLE leads DROP COLUMN portal_user_id;
ALTER TABLE lead_events DROP COLUMN customer_text;
ALTER TABLE lead_events DROP COLUMN customer_visible;
DROP TABLE portal_audit;
DROP TABLE portal_login_requests;
DROP TABLE customer_users;
