-- Customer support chats can come from more than one public site (Source Easy and the
-- Fortune Engineering website embed). Every conversation and visitor token is tagged with
-- the site it came from; existing rows are Source Easy. A visitor token is only valid on
-- the site it was issued for.

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS source_site text NOT NULL DEFAULT 'sourceeasy';
ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_source_site_check;
ALTER TABLE chat_conversations ADD CONSTRAINT chat_conversations_source_site_check
  CHECK (source_site IN ('sourceeasy', 'fortune_engineering'));
CREATE INDEX IF NOT EXISTS chat_conversations_source_site
  ON chat_conversations (source_site) WHERE kind = 'CUSTOMER_SUPPORT';

ALTER TABLE chat_visitors
  ADD COLUMN IF NOT EXISTS source_site text NOT NULL DEFAULT 'sourceeasy';
ALTER TABLE chat_visitors DROP CONSTRAINT IF EXISTS chat_visitors_source_site_check;
ALTER TABLE chat_visitors ADD CONSTRAINT chat_visitors_source_site_check
  CHECK (source_site IN ('sourceeasy', 'fortune_engineering'));

-- DOWN
-- DROP INDEX IF EXISTS chat_conversations_source_site;
-- ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_source_site_check, DROP COLUMN IF EXISTS source_site;
-- ALTER TABLE chat_visitors DROP CONSTRAINT IF EXISTS chat_visitors_source_site_check, DROP COLUMN IF EXISTS source_site;
