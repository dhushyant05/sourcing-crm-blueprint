-- Up Migration
-- Carton packing on each China supplier quote (cm / kg). Totals are computed in the API.
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS carton_length_cm numeric(12,3),
  ADD COLUMN IF NOT EXISTS carton_width_cm numeric(12,3),
  ADD COLUMN IF NOT EXISTS carton_height_cm numeric(12,3),
  ADD COLUMN IF NOT EXISTS carton_units integer,
  ADD COLUMN IF NOT EXISTS carton_gross_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS carton_net_kg numeric(12,3);

-- Down Migration
ALTER TABLE quotes
  DROP COLUMN IF EXISTS carton_length_cm,
  DROP COLUMN IF EXISTS carton_width_cm,
  DROP COLUMN IF EXISTS carton_height_cm,
  DROP COLUMN IF EXISTS carton_units,
  DROP COLUMN IF EXISTS carton_gross_kg,
  DROP COLUMN IF EXISTS carton_net_kg;
