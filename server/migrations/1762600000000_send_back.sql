-- Up Migration
-- Send-back loop between India and China: the open request lives on lead_meta (one at a time per lead),
-- the quote keeps its revision counter + open revision request. Notes themselves are timeline events (SENT_BACK / BACK_ANSWERED / QUOTE_REVISED).
ALTER TABLE lead_meta ADD COLUMN IF NOT EXISTS back_side text, ADD COLUMN IF NOT EXISTS back_note text, ADD COLUMN IF NOT EXISTS back_by text,
  ADD COLUMN IF NOT EXISTS back_at text, ADD COLUMN IF NOT EXISTS back_quote_id text, ADD COLUMN IF NOT EXISTS back_from text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS rev_note text,
  ADD COLUMN IF NOT EXISTS rev_at text, ADD COLUMN IF NOT EXISTS rev_by text;

-- Down Migration
ALTER TABLE quotes DROP COLUMN IF EXISTS revision, DROP COLUMN IF EXISTS rev_note, DROP COLUMN IF EXISTS rev_at, DROP COLUMN IF EXISTS rev_by;
ALTER TABLE lead_meta DROP COLUMN IF EXISTS back_side, DROP COLUMN IF EXISTS back_note, DROP COLUMN IF EXISTS back_by, DROP COLUMN IF EXISTS back_at, DROP COLUMN IF EXISTS back_quote_id, DROP COLUMN IF EXISTS back_from;
