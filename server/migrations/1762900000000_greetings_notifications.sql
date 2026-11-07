-- Up Migration
-- Festival / event greetings: plain text + uploaded raster images (PNG/JPEG/WebP only) in fixed preset layouts. No HTML, SVG or scripts.
CREATE TABLE greetings (
  id text PRIMARY KEY,
  name text NOT NULL,                                  -- internal name (staff only)
  status text NOT NULL DEFAULT 'DRAFT',               -- DRAFT | PUBLISHED | UNPUBLISHED
  layout text NOT NULL DEFAULT 'CLASSIC',             -- IMAGE (uploaded artwork only) | CLASSIC | FESTIVE | MINIMAL
  theme text NOT NULL DEFAULT 'BRAND',                -- preset colour scheme
  heading text, message text, alt_text text,
  link_path text,                                      -- optional same-site path only (e.g. /portal)
  link_label text,
  image_desktop text, image_mobile text,              -- file ids under this greeting's own upload folder
  surfaces text[] NOT NULL DEFAULT '{PUBLIC}',        -- PUBLIC | PORTAL | APP
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  dismissible boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,                 -- bumped on publish: a new publication shows again after dismissal
  created_by text, updated_by text, published_by text, published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX greetings_live ON greetings (status, starts_at, ends_at);
CREATE TABLE greeting_audit (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  greeting_id text NOT NULL, actor_id text, action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX greeting_audit_g ON greeting_audit (greeting_id, id);

-- Customer notifications: an outbox; adapters stay disabled until configured (nothing is sent otherwise).
CREATE TABLE notification_outbox (
  id text PRIMARY KEY,
  channel text NOT NULL,                               -- EMAIL | PUSH
  customer_user_id text NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
  template text NOT NULL,
  vars jsonb NOT NULL DEFAULT '{}',                    -- allowlisted customer-safe variables only
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING',              -- PENDING | SENT | SKIPPED | FAILED
  reason text, attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz
);
CREATE INDEX notification_outbox_pending ON notification_outbox (status, created_at);
CREATE TABLE customer_notification_prefs (
  customer_user_id text PRIMARY KEY REFERENCES customer_users(id) ON DELETE CASCADE,
  email boolean NOT NULL DEFAULT true, push boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customer_device_tokens (
  token text PRIMARY KEY,
  customer_user_id text NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'android',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_device_tokens_user ON customer_device_tokens (customer_user_id);

-- Down Migration
DROP TABLE customer_device_tokens;
DROP TABLE customer_notification_prefs;
DROP TABLE notification_outbox;
DROP TABLE greeting_audit;
DROP TABLE greetings;
