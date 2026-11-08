-- Up Migration
-- Customer-visible version of a freight quote: bumped only when what the customer sees changes (amount, terms, note).
-- Accepting requires the version the customer was shown, so an edited price can never be accepted unseen.
ALTER TABLE freight_quotes ADD COLUMN IF NOT EXISTS customer_rev integer NOT NULL DEFAULT 1;

-- Down Migration
ALTER TABLE freight_quotes DROP COLUMN IF EXISTS customer_rev;
