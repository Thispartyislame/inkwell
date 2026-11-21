-- Phase 4: production tracking on jobs (approved quotes, then their invoices).
ALTER TABLE quotes ADD COLUMN production_status TEXT;
ALTER TABLE quotes ADD COLUMN production_updated_at TEXT;
ALTER TABLE invoices ADD COLUMN production_status TEXT;
ALTER TABLE invoices ADD COLUMN production_updated_at TEXT;
CREATE INDEX quotes_production ON quotes (production_status);
CREATE INDEX invoices_production ON invoices (production_status);
