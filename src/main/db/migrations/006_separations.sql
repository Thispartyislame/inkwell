-- Phase 5: spot-color separation jobs. Settings are stored whole (settings) and the parts the
-- spec names are kept as their own columns for reporting/inspection.
CREATE TABLE separation_jobs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  source_attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  source_rel_path TEXT NOT NULL,
  source_name TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL CHECK (source_kind IN ('svg', 'pdf', 'ai', 'eps')),
  owner_type TEXT CHECK (owner_type IS NULL OR owner_type IN ('quote', 'invoice')),
  owner_id INTEGER,
  imprint_uid TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  detected_colors TEXT NOT NULL DEFAULT '[]',
  color_mapping TEXT NOT NULL DEFAULT '{}',
  ink_order TEXT NOT NULL DEFAULT '[]',
  underbase TEXT NOT NULL DEFAULT '{}',
  trap TEXT NOT NULL DEFAULT '{}',
  halftone TEXT NOT NULL DEFAULT '{}',
  film_options TEXT NOT NULL DEFAULT '{}',
  plate_count INTEGER NOT NULL DEFAULT 0,
  ink_count INTEGER NOT NULL DEFAULT 0,
  has_underbase INTEGER NOT NULL DEFAULT 0,
  output_pdf_path TEXT,
  output_attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  thumbnail_attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX separation_jobs_owner ON separation_jobs (owner_type, owner_id);

ALTER TABLE quote_imprints ADD COLUMN separation_job_id INTEGER;
ALTER TABLE invoice_imprints ADD COLUMN separation_job_id INTEGER;
