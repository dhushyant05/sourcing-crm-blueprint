-- Customer-facing support chat: guest (visitor cookie) and logged-in portal
-- conversations land in a "Customer support" team inbox. China staff must never
-- be members of that inbox and must never see these threads.

ALTER TABLE chat_conversations ALTER COLUMN lead_id DROP NOT NULL;
ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_lead_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS chat_conversations_lead_uidx
  ON chat_conversations (lead_id) WHERE lead_id IS NOT NULL;

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'LEAD',
  ADD COLUMN IF NOT EXISTS visitor_id text,
  ADD COLUMN IF NOT EXISTS customer_id text,
  ADD COLUMN IF NOT EXISTS guest_name text,
  ADD COLUMN IF NOT EXISTS guest_email text,
  ADD COLUMN IF NOT EXISTS guest_phone text,
  ADD COLUMN IF NOT EXISTS product_id text,
  ADD COLUMN IF NOT EXISTS product_title text,
  ADD COLUMN IF NOT EXISTS product_slug text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS converted_lead_id text,
  ADD COLUMN IF NOT EXISTS linked_lead_id text,
  ADD COLUMN IF NOT EXISTS linked_order_id text,
  ADD COLUMN IF NOT EXISTS consent_at timestamptz;

ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_kind_check;
ALTER TABLE chat_conversations ADD CONSTRAINT chat_conversations_kind_check
  CHECK (kind IN ('LEAD', 'CUSTOMER_SUPPORT'));

CREATE INDEX IF NOT EXISTS chat_conversations_visitor ON chat_conversations (visitor_id);
CREATE INDEX IF NOT EXISTS chat_conversations_customer ON chat_conversations (customer_id);

CREATE TABLE IF NOT EXISTS chat_visitors (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_kind_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_kind_check
  CHECK (kind IN ('text', 'quote_reference', 'system'));

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS author_kind text NOT NULL DEFAULT 'staff',
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'customer';

ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_author_kind_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_author_kind_check
  CHECK (author_kind IN ('staff', 'guest', 'customer', 'system'));
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_visibility_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_visibility_check
  CHECK (visibility IN ('customer', 'staff_only'));

ALTER TABLE notifications ALTER COLUMN lead_id DROP NOT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS conversation_id text;
CREATE INDEX IF NOT EXISTS notifications_conversation ON notifications (conversation_id);

INSERT INTO chat_inboxes (id, slug, name, kind) VALUES
  ('inbox-customer-support', 'customer-support', 'Customer support', 'TEAM')
ON CONFLICT (id) DO NOTHING;

-- DOWN
-- DELETE FROM chat_inboxes WHERE id = 'inbox-customer-support';
-- ALTER TABLE notifications DROP COLUMN IF EXISTS conversation_id;
-- ALTER TABLE chat_messages DROP COLUMN IF EXISTS author_kind, DROP COLUMN IF EXISTS visibility;
-- DROP TABLE IF EXISTS chat_visitors;
-- ALTER TABLE chat_conversations DROP COLUMN IF EXISTS kind, DROP COLUMN IF EXISTS visitor_id, DROP COLUMN IF EXISTS customer_id,
--   DROP COLUMN IF EXISTS guest_name, DROP COLUMN IF EXISTS guest_email, DROP COLUMN IF EXISTS guest_phone,
--   DROP COLUMN IF EXISTS product_id, DROP COLUMN IF EXISTS product_title, DROP COLUMN IF EXISTS product_slug,
--   DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS converted_lead_id, DROP COLUMN IF EXISTS linked_lead_id,
--   DROP COLUMN IF EXISTS linked_order_id, DROP COLUMN IF EXISTS consent_at;
