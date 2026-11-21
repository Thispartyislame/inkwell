-- Phase 2: quotes. A quote is saved whole (lines, sizes, imprints, fees replaced together in
-- one transaction). Child rows carry a stable `uid` so the editor keeps its state across saves.

CREATE TABLE quotes (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  root_number TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  previous_revision_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  reorder_of_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
  contact_id INTEGER REFERENCES customer_contacts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'approved', 'declined', 'expired', 'superseded')),
  job_name TEXT NOT NULL DEFAULT '',
  issued_on TEXT NOT NULL,
  expires_on TEXT,
  in_hands_on TEXT,
  customer_notes TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  tax_bp_override INTEGER CHECK (tax_bp_override IS NULL OR tax_bp_override BETWEEN 0 AND 10000),
  discount_mode TEXT NOT NULL DEFAULT 'percent' CHECK (discount_mode IN ('percent', 'flat')),
  discount_value INTEGER NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  deposit_bp INTEGER NOT NULL DEFAULT 0 CHECK (deposit_bp BETWEEN 0 AND 10000),
  rush INTEGER NOT NULL DEFAULT 0,
  charge_tax_anyway INTEGER NOT NULL DEFAULT 0,
  is_reorder INTEGER NOT NULL DEFAULT 0,
  disabled_auto_fees TEXT NOT NULL DEFAULT '[]',
  -- pricing rules and matrices used for this quote; frozen once the quote leaves draft
  pricing_base TEXT,
  -- summary of the last computed totals (for lists, reports, the customer page)
  totals TEXT NOT NULL DEFAULT '{}',
  total_cents INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  approved_at TEXT,
  approved_by_name TEXT NOT NULL DEFAULT '',
  declined_at TEXT,
  converted_invoice_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX quotes_customer ON quotes (customer_id);
CREATE INDEX quotes_status ON quotes (status);
CREATE INDEX quotes_issued ON quotes (issued_on);
CREATE INDEX quotes_root ON quotes (root_number);

CREATE TABLE quote_line_items (
  id INTEGER PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  garment_id INTEGER REFERENCES garments(id) ON DELETE SET NULL,
  garment TEXT NOT NULL DEFAULT '{}',
  costs TEXT NOT NULL DEFAULT '{}',
  description TEXT NOT NULL DEFAULT '',
  customer_supplied INTEGER NOT NULL DEFAULT 0,
  color_name TEXT NOT NULL DEFAULT '',
  color_hex TEXT NOT NULL DEFAULT '#ffffff',
  is_dark INTEGER NOT NULL DEFAULT 0,
  overrides TEXT NOT NULL DEFAULT '{}',
  override_reason TEXT NOT NULL DEFAULT '',
  -- calculated unit price per size group at the last save, kept alongside any override
  calculated TEXT NOT NULL DEFAULT '[]',
  total_cents INTEGER NOT NULL DEFAULT 0,
  UNIQUE (quote_id, uid)
);
CREATE INDEX quote_lines_quote ON quote_line_items (quote_id);

CREATE TABLE quote_line_sizes (
  id INTEGER PRIMARY KEY,
  line_item_id INTEGER NOT NULL REFERENCES quote_line_items(id) ON DELETE CASCADE,
  size TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty >= 0),
  sort_order INTEGER NOT NULL
);
CREATE INDEX quote_sizes_line ON quote_line_sizes (line_item_id);

CREATE TABLE quote_imprints (
  id INTEGER PRIMARY KEY,
  line_item_id INTEGER NOT NULL REFERENCES quote_line_items(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  location TEXT NOT NULL,
  location_custom TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL,
  colors INTEGER NOT NULL DEFAULT 1 CHECK (colors >= 0),
  underbase INTEGER NOT NULL DEFAULT 0,
  underbase_source TEXT NOT NULL DEFAULT 'auto',
  specialty TEXT NOT NULL DEFAULT '[]',
  print_size TEXT NOT NULL DEFAULT 'standard',
  stitch_count INTEGER NOT NULL DEFAULT 0,
  new_digitizing INTEGER NOT NULL DEFAULT 0,
  transfer_size INTEGER NOT NULL DEFAULT 1,
  is_reorder INTEGER NOT NULL DEFAULT 0,
  matrix_id INTEGER REFERENCES pricing_matrices(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  artwork_attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL
);
CREATE INDEX quote_imprints_line ON quote_imprints (line_item_id);

CREATE TABLE quote_fees (
  id INTEGER PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  fee_preset_id INTEGER REFERENCES fee_presets(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  basis TEXT NOT NULL DEFAULT 'per_job',
  quantity INTEGER,
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  taxable INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX quote_fees_quote ON quote_fees (quote_id);
