-- Up Migration
-- Source Easy's own database (replaces Twenty CRM + the SQLite users.db). Timestamps are timestamptz, money is numeric.

CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  token_version integer NOT NULL DEFAULT 0,
  language text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email ON users (lower(email));

CREATE TABLE avatars (user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data bytea NOT NULL, updated_at timestamptz NOT NULL);

-- Shared lead reference SE-YYMM-NNNN: one counter row per month, incremented atomically.
CREATE TABLE ref_counters (yymm text PRIMARY KEY, n integer NOT NULL);

CREATE TABLE leads (
  id text PRIMARY KEY,
  lead_ref text UNIQUE,
  name text,
  client_name text,
  contact_name text,
  contact_phone text,
  contact_phone_code text,
  contact_phone_country text,
  contact_email text,
  product_interest text,
  quantity double precision,
  unit text,
  target_price numeric(18,6),
  target_currency text,
  delivery_city text,
  reference_url text,
  enquiry_message text,
  summary text,
  attachment_count integer NOT NULL DEFAULT 0,
  source_channel text,
  status text NOT NULL DEFAULT 'NEW',
  assigned_office text,
  assigned_china_agent text,
  chatwoot_url text,
  win_loss_reason text,
  office text,
  client_ref text,
  -- ownership (who raised it, current owner, which office holds it) and priority
  raised_by text,
  assigned_to text,
  owner_office text,
  assigned_at timestamptz,
  priority boolean NOT NULL DEFAULT false,
  priority_at timestamptz,
  legacy_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_status ON leads (status);
CREATE INDEX leads_assigned_to ON leads (assigned_to);
CREATE INDEX leads_created ON leads (created_at DESC);

-- Lead media (photos/videos/documents). Bytes stay on the private uploads volume; this is the index.
CREATE TABLE lead_media (
  id text NOT NULL,
  owner_key text NOT NULL,          -- lead id, or q_<quote id> for supplier-quote files
  name text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_key, id)
);

CREATE TABLE suppliers (
  id text PRIMARY KEY,
  name text NOT NULL,
  contact text,
  phone text,
  wechat text,
  city text,
  notes text,
  created_by text,
  legacy_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX suppliers_name ON suppliers (lower(name));

CREATE TABLE quotes (
  id text PRIMARY KEY,
  seq bigserial,
  lead_id text NOT NULL,
  supplier_id text REFERENCES suppliers(id) ON DELETE SET NULL,
  product text NOT NULL,
  unit_price numeric(18,6) NOT NULL,
  currency text NOT NULL,
  moq text, lead_time text, validity text, notes text,
  ship_cost numeric(18,6), ship_currency text, ship_term text, ship_mode text, ship_port text, ship_transit text,
  client_price numeric(18,6), client_currency text, client_notes text,
  status text NOT NULL DEFAULT 'DRAFT',
  sent_at timestamptz, decided_at timestamptz, reject_reason text,
  pdf_token text UNIQUE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX quotes_lead ON quotes (lead_id, created_at);
CREATE INDEX quotes_supplier ON quotes (supplier_id);

-- India's customer quote on a supplier quote (all INR).
CREATE TABLE customer_quotes (
  quote_id text PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
  qty double precision NOT NULL,
  unit_price numeric(18,6) NOT NULL,
  gst_pct numeric(6,3) NOT NULL DEFAULT 0,
  ship_cost numeric(18,6) NOT NULL DEFAULT 0,
  ship_term text, ship_mode text, port text, transit text,
  other_charges numeric(18,6) NOT NULL DEFAULT 0,
  other_label text, validity text, terms text,
  updated_at timestamptz NOT NULL
);

CREATE TABLE quote_rejections (
  id text PRIMARY KEY,
  lead_id text NOT NULL,
  quote_id text NOT NULL,
  reason_code text NOT NULL, reason_text text,
  by_user text NOT NULL, at timestamptz NOT NULL,
  resolution text, target_price numeric(18,6), target_currency text, notes text, resolved_by text, resolved_at timestamptz
);
CREATE INDEX quote_rejections_lead ON quote_rejections (lead_id, at);

CREATE TABLE orders (
  id text PRIMARY KEY,
  lead_id text NOT NULL,
  quote_id text NOT NULL UNIQUE REFERENCES quotes(id) ON DELETE CASCADE,
  lead_ref text,
  product text NOT NULL,
  qty double precision NOT NULL,
  agreed_price numeric(18,6) NOT NULL,
  advance numeric(18,6) NOT NULL DEFAULT 0,
  payment_status text NOT NULL,
  expected_ship date,
  production text NOT NULL,
  tracking text, container text, etd date, eta date,
  india_status text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX orders_lead ON orders (lead_id);

CREATE TABLE shipments (
  id text PRIMARY KEY,
  order_id text UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  lead_id text,
  ref text NOT NULL,
  mode text, incoterm text, port text, transit text,
  carrier text, tracking text, container text, etd date, eta date,
  status text NOT NULL,
  customs_note text, delivered_at date,

  legacy_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX shipments_lead ON shipments (lead_id);

CREATE TABLE notifications (
  id text PRIMARY KEY,
  seq bigserial,
  user_id text NOT NULL,
  lead_id text NOT NULL,
  lead_ref text, product text,
  kind text NOT NULL, office text NOT NULL, by_name text, detail text,
  created_at timestamptz NOT NULL,
  read_at timestamptz
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread ON notifications (user_id) WHERE read_at IS NULL;

-- Timeline (append-only).
CREATE TABLE lead_events (
  id text PRIMARY KEY,
  seq bigserial,
  lead_id text NOT NULL,
  at timestamptz NOT NULL,
  kind text NOT NULL,
  actor_id text, actor_name text, actor_office text,
  data jsonb NOT NULL DEFAULT '{}',
  vis text NOT NULL
);
CREATE INDEX lead_events_lead ON lead_events (lead_id, at, seq);

-- SLA: the running clock per lead, and finished runs for the report.
CREATE TABLE sla_clocks (
  lead_id text PRIMARY KEY,
  office text NOT NULL, assignee text,
  started_at timestamptz NOT NULL, due_at timestamptz NOT NULL,
  warned boolean NOT NULL DEFAULT false, breached boolean NOT NULL DEFAULT false
);
CREATE TABLE sla_runs (
  id text PRIMARY KEY,
  lead_id text NOT NULL, office text NOT NULL, assignee text,
  started_at timestamptz NOT NULL, due_at timestamptz NOT NULL, ended_at timestamptz NOT NULL, breached boolean NOT NULL
);
CREATE INDEX sla_runs_ended ON sla_runs (ended_at);

-- Lost-lead workflow: permanent close, follow-up reminder, copied-from link.
CREATE TABLE lead_meta (
  lead_id text PRIMARY KEY,
  closed_at timestamptz, closed_by text,
  follow_up date, follow_up_by text, follow_up_sent boolean NOT NULL DEFAULT false,
  from_id text, from_ref text
);

CREATE TABLE settings (key text PRIMARY KEY, value jsonb NOT NULL);

-- Contacts/companies that existed only in Twenty (kept for reference; not used by the app yet).
CREATE TABLE legacy_contacts (
  id text PRIMARY KEY, kind text NOT NULL, name text, email text, phone text, company text, data jsonb NOT NULL, created_at timestamptz
);

-- Per-user feature permissions (overrides on top of role defaults; set by the super admin). Hard data-separation
-- rules (China never sees customer identity, India never sees supplier identity) are NOT permissions and cannot be granted.
CREATE TABLE user_permissions (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perm text NOT NULL,
  granted boolean NOT NULL,
  updated_by text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, perm)
);
CREATE TABLE permission_audit (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL, perm text NOT NULL,
  before boolean, after boolean,   -- null = role default
  changed_by text, changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX permission_audit_user ON permission_audit (user_id, changed_at DESC);

-- Down Migration
DROP TABLE IF EXISTS permission_audit, user_permissions, legacy_contacts, settings, lead_meta, sla_runs, sla_clocks, lead_events, notifications, shipments, orders,
  quote_rejections, customer_quotes, quotes, suppliers, lead_media, leads, ref_counters, avatars, users CASCADE;

