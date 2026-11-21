-- Native India↔China staff chat (no Chatwoot). Custom roles set chat-permission
-- defaults; per-person overrides stay in user_permissions. Office privacy rules
-- are unchanged and cannot be granted away.

CREATE TABLE custom_roles (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE custom_role_permissions (
  role_id text NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  perm text NOT NULL,
  granted boolean NOT NULL,
  PRIMARY KEY (role_id, perm)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id text REFERENCES custom_roles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS users_custom_role_idx ON users (custom_role_id);

CREATE TABLE chat_inboxes (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PERSONAL','TEAM')),
  owner_user_id text REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX chat_inboxes_personal_uidx ON chat_inboxes (owner_user_id) WHERE kind = 'PERSONAL';

CREATE TABLE chat_inbox_members (
  inbox_id text NOT NULL REFERENCES chat_inboxes(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by text,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (inbox_id, user_id)
);

CREATE TABLE chat_conversations (
  id text PRIMARY KEY,
  lead_id text NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  assigned_to text REFERENCES users(id) ON DELETE SET NULL,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_conversations_last ON chat_conversations (last_message_at DESC);

CREATE TABLE chat_conversation_inboxes (
  conversation_id text NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  inbox_id text NOT NULL REFERENCES chat_inboxes(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, inbox_id)
);

CREATE TABLE chat_participants (
  conversation_id text NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by text,
  added_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  last_read_message_id text,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE chat_messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id text REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','quote_reference')),
  body text NOT NULL DEFAULT '',
  quote_id text REFERENCES quotes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_conv ON chat_messages (conversation_id, created_at, id);

CREATE TABLE chat_canned_replies (
  id text PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO chat_inboxes (id, slug, name, kind) VALUES
  ('inbox-india', 'india-team', 'India team', 'TEAM'),
  ('inbox-china', 'china-team', 'China team', 'TEAM'),
  ('inbox-marketplace', 'marketplace', 'Marketplace', 'TEAM')
ON CONFLICT (id) DO NOTHING;

-- DOWN
-- DROP TABLE IF EXISTS chat_canned_replies, chat_messages, chat_participants, chat_conversation_inboxes, chat_conversations, chat_inbox_members, chat_inboxes, custom_role_permissions, custom_roles;
-- ALTER TABLE users DROP COLUMN IF EXISTS custom_role_id;
