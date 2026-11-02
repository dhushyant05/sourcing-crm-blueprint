-- Up Migration
ALTER TABLE orders ADD COLUMN closed_at TIMESTAMPTZ;
UPDATE orders o SET closed_at = now() FROM leads l WHERE l.id = o.lead_id AND o.india_status = 'DELIVERED' AND l.status = 'COMPLETED';

-- Down Migration
ALTER TABLE orders DROP COLUMN closed_at;
