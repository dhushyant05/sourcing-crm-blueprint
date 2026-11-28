-- Internal staff chat: channels and direct messages. Customers and suppliers can never join.
-- Default channels: All staff, India team, China team (mandatory for the matching office).

ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_kind_check;
ALTER TABLE chat_conversations ADD CONSTRAINT chat_conversations_kind_check
  CHECK (kind IN ('LEAD', 'CUSTOMER_SUPPORT', 'SUPPLIER_EMAIL', 'CHANNEL', 'DM'));

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS is_mandatory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS dm_key text;

CREATE UNIQUE INDEX IF NOT EXISTS chat_conversations_channel_slug
  ON chat_conversations (slug) WHERE kind = 'CHANNEL' AND slug IS NOT NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chat_conversations_dm_key
  ON chat_conversations (dm_key) WHERE kind = 'DM' AND dm_key IS NOT NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS chat_conversations_internal
  ON chat_conversations (kind, last_message_at DESC) WHERE kind IN ('CHANNEL', 'DM');

CREATE TABLE IF NOT EXISTS chat_mentions (
  message_id text NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);

INSERT INTO chat_conversations (id, lead_id, kind, title, slug, is_mandatory, is_group, created_at)
VALUES
  ('channel-all-staff', NULL, 'CHANNEL', 'All staff', 'all-staff', true, true, now()),
  ('channel-india-team', NULL, 'CHANNEL', 'India team', 'india-team', true, true, now()),
  ('channel-china-team', NULL, 'CHANNEL', 'China team', 'china-team', true, true, now())
ON CONFLICT (id) DO NOTHING;

-- DOWN
-- DELETE FROM chat_conversations WHERE kind IN ('CHANNEL', 'DM');
-- DROP TABLE IF EXISTS chat_mentions;
-- ALTER TABLE chat_conversations DROP COLUMN IF EXISTS title, DROP COLUMN IF EXISTS slug, DROP COLUMN IF EXISTS is_mandatory,
--   DROP COLUMN IF EXISTS is_group, DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS dm_key;
-- ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_kind_check;
-- ALTER TABLE chat_conversations ADD CONSTRAINT chat_conversations_kind_check CHECK (kind IN ('LEAD', 'CUSTOMER_SUPPORT', 'SUPPLIER_EMAIL'));
