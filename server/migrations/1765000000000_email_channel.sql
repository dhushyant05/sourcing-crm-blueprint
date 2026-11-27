-- Email channel for team inboxes. Customer email lands in "Customer support" (India / Marketplace / super admin);
-- supplier email lands in "Supplier email" (China / super admin). Ships disabled: nothing is received or sent
-- until EMAIL_CHANNEL_ENABLED and a provider are configured.

ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_kind_check;
ALTER TABLE chat_conversations ADD CONSTRAINT chat_conversations_kind_check
  CHECK (kind IN ('LEAD', 'CUSTOMER_SUPPORT', 'SUPPLIER_EMAIL'));

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'CHAT',
  ADD COLUMN IF NOT EXISTS email_address text,
  ADD COLUMN IF NOT EXISTS email_subject text,
  ADD COLUMN IF NOT EXISTS email_mailbox text,
  ADD COLUMN IF NOT EXISTS supplier_id text;
ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_channel_check;
ALTER TABLE chat_conversations ADD CONSTRAINT chat_conversations_channel_check CHECK (channel IN ('CHAT', 'EMAIL'));
CREATE INDEX IF NOT EXISTS chat_conversations_email ON chat_conversations (email_address) WHERE email_address IS NOT NULL;

ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_author_kind_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_author_kind_check
  CHECK (author_kind IN ('staff', 'guest', 'customer', 'supplier', 'system'));
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS email_message_id text,
  ADD COLUMN IF NOT EXISTS email_status text,
  ADD COLUMN IF NOT EXISTS email_error text;
CREATE INDEX IF NOT EXISTS chat_messages_email_mid ON chat_messages (email_message_id) WHERE email_message_id IS NOT NULL;

-- Idempotency + audit for inbound mail (no bodies stored here).
CREATE TABLE IF NOT EXISTS email_inbound_log (
  id text PRIMARY KEY,
  message_id text NOT NULL UNIQUE,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  side text,
  conversation_id text,
  reason text
);

-- Per-person staff notification preferences (unread chat email).
CREATE TABLE IF NOT EXISTS staff_notification_prefs (
  user_id text PRIMARY KEY,
  chat_email boolean NOT NULL DEFAULT true,
  last_chat_email_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO chat_inboxes (id, slug, name, kind) VALUES
  ('inbox-supplier-email', 'supplier-email', 'Supplier email', 'TEAM')
ON CONFLICT (id) DO NOTHING;

-- DOWN
-- DELETE FROM chat_inboxes WHERE id = 'inbox-supplier-email';
-- DROP TABLE IF EXISTS staff_notification_prefs; DROP TABLE IF EXISTS email_inbound_log;
-- ALTER TABLE chat_messages DROP COLUMN IF EXISTS email_message_id, DROP COLUMN IF EXISTS email_status, DROP COLUMN IF EXISTS email_error;
-- ALTER TABLE chat_conversations DROP COLUMN IF EXISTS channel, DROP COLUMN IF EXISTS email_address, DROP COLUMN IF EXISTS email_subject,
--   DROP COLUMN IF EXISTS email_mailbox, DROP COLUMN IF EXISTS supplier_id;
