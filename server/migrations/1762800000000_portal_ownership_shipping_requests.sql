-- Up Migration
-- 1) Portal ownership is explicit. `leads.customer_id` stays the internal CRM link (auto-built from spoofable contact details);
--    a lead is visible in a customer's portal ONLY when `portal_customer_id` = that customer AND it is still linked to them.
--    It is set by an authenticated portal submission (from the token) or by an India admin who verified the link. Legacy
--    leads are NOT exposed retroactively: only leads created through the portal itself keep visibility.
ALTER TABLE leads ADD COLUMN portal_customer_id text REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN portal_shared_by text;
ALTER TABLE leads ADD COLUMN portal_shared_at timestamptz;
UPDATE leads SET portal_customer_id = customer_id, portal_shared_at = now()
  WHERE source_channel = 'PORTAL' AND portal_user_id IS NOT NULL AND customer_id IS NOT NULL
    AND portal_user_id IN (SELECT id FROM customer_users WHERE customer_users.customer_id = leads.customer_id);
CREATE INDEX leads_portal_customer ON leads (portal_customer_id) WHERE portal_customer_id IS NOT NULL;

-- 2) Shipping Requests (SH-YYMM-NNNN): SOURCED (continues our order) or FREIGHT_ONLY (customer's own goods).
CREATE TABLE shipping_requests (
  id text PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  kind text NOT NULL,                                   -- SOURCED | FREIGHT_ONLY
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE RESTRICT, -- ownership; isolation is keyed on it
  created_by_kind text NOT NULL,                        -- CUSTOMER | STAFF
  created_by text,                                      -- customer_users.id or users.id
  lead_id text REFERENCES leads(id) ON DELETE SET NULL, -- SOURCED only
  order_id text REFERENCES orders(id) ON DELETE SET NULL, -- SOURCED only
  goods text NOT NULL,
  quantity numeric, unit text, packages integer, weight_kg numeric, cbm numeric,
  shipper_name text, shipper_phone text, pickup_address text, pickup_city text, -- FREIGHT_ONLY: the customer's own shipper / pickup
  dest_city text, dest_address text, dest_pincode text,
  mode text, incoterm text, ready_date date,
  customer_note text,
  status text NOT NULL DEFAULT 'SUBMITTED',             -- SUBMITTED UNDER_REVIEW NEEDS_INFO QUOTED ACCEPTED BOOKED IN_TRANSIT ARRIVED CUSTOMS CLEARED OUT_FOR_DELIVERY DELIVERED REJECTED CANCELLED
  question text,                                        -- customer-facing "more info needed" question (written for the customer)
  carrier text, tracking text, container text, etd date, eta date, delivered_at date, -- FREIGHT_ONLY tracking (SOURCED uses its Shipment)
  owner_office text NOT NULL DEFAULT 'INDIA',
  assigned_to text,
  internal_note text,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipping_requests_customer ON shipping_requests (customer_id, created_at DESC);
CREATE INDEX shipping_requests_status ON shipping_requests (status, created_at DESC);
CREATE UNIQUE INDEX shipping_requests_order ON shipping_requests (order_id) WHERE order_id IS NOT NULL AND status NOT IN ('REJECTED','CANCELLED');
CREATE TABLE freight_quotes (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES shipping_requests(id) ON DELETE CASCADE,
  n integer NOT NULL,
  amount numeric NOT NULL, currency text NOT NULL DEFAULT 'INR',
  mode text, incoterm text, transit text, valid_until date,
  customer_note text,                                   -- written for the customer
  internal_cost numeric,                                -- staff only (never in a portal DTO)
  status text NOT NULL DEFAULT 'SENT',                  -- SENT | ACCEPTED | REJECTED | WITHDRAWN
  reason_code text, reason text,
  created_by text, created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (request_id, n)
);
CREATE TABLE shipping_request_events (
  id bigserial PRIMARY KEY,
  request_id text NOT NULL REFERENCES shipping_requests(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  actor_kind text NOT NULL, actor_id text, actor_name text,
  data jsonb NOT NULL DEFAULT '{}',                      -- internal
  customer_visible boolean NOT NULL DEFAULT false,      -- internal by default
  customer_text text
);
CREATE INDEX shipping_request_events_req ON shipping_request_events (request_id, id);
-- Files: customers see only files they uploaded themselves (shared = true); staff uploads stay internal.
CREATE TABLE shipping_request_files (
  request_id text NOT NULL REFERENCES shipping_requests(id) ON DELETE CASCADE,
  file_id text NOT NULL,
  uploaded_by_kind text NOT NULL,
  customer_visible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, file_id)
);

-- Down Migration
DROP TABLE shipping_request_files;
DROP TABLE shipping_request_events;
DROP TABLE freight_quotes;
DROP TABLE shipping_requests;
DROP INDEX IF EXISTS leads_portal_customer;
ALTER TABLE leads DROP COLUMN portal_shared_at;
ALTER TABLE leads DROP COLUMN portal_shared_by;
ALTER TABLE leads DROP COLUMN portal_customer_id;
