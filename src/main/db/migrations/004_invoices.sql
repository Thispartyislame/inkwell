-- Phase 3: invoices and payments.

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  source_quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
  contact_id INTEGER REFERENCES customer_contacts(id) ON DELETE SET NULL,
  -- draft → sent → partially_paid → paid; void. "Overdue" is computed from due_on.
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partially_paid', 'paid', 'void')),
  job_name TEXT NOT NULL DEFAULT '',
  po_number TEXT NOT NULL DEFAULT '',
  issued_on TEXT NOT NULL,
  due_on TEXT,
  payment_terms TEXT NOT NULL DEFAULT '',
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
  -- converted invoices keep the quote's pricing even while still a draft
  pricing_locked INTEGER NOT NULL DEFAULT 0,
  pricing_base TEXT,
  totals TEXT NOT NULL DEFAULT '{}',
  total_cents INTEGER NOT NULL DEFAULT 0,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  paid_at TEXT,
  voided_at TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX invoices_customer ON invoices (customer_id);
CREATE INDEX invoices_status ON invoices (status);
CREATE INDEX invoices_issued ON invoices (issued_on);
CREATE INDEX invoices_due ON invoices (due_on);
-- one live invoice per quote (a voided one doesn't block converting again)
CREATE UNIQUE INDEX invoices_one_per_quote ON invoices (source_quote_id) WHERE source_quote_id IS NOT NULL AND status <> 'void';

CREATE TABLE invoice_line_items (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
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
  calculated TEXT NOT NULL DEFAULT '[]',
  total_cents INTEGER NOT NULL DEFAULT 0,
  UNIQUE (invoice_id, uid)
);
CREATE INDEX invoice_lines_invoice ON invoice_line_items (invoice_id);

CREATE TABLE invoice_line_sizes (
  id INTEGER PRIMARY KEY,
  line_item_id INTEGER NOT NULL REFERENCES invoice_line_items(id) ON DELETE CASCADE,
  size TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty >= 0),
  sort_order INTEGER NOT NULL
);
CREATE INDEX invoice_sizes_line ON invoice_line_sizes (line_item_id);

CREATE TABLE invoice_imprints (
  id INTEGER PRIMARY KEY,
  line_item_id INTEGER NOT NULL REFERENCES invoice_line_items(id) ON DELETE CASCADE,
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
CREATE INDEX invoice_imprints_line ON invoice_imprints (line_item_id);

CREATE TABLE invoice_fees (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
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
CREATE INDEX invoice_fees_invoice ON invoice_fees (invoice_id);

-- A payment belongs to an invoice, or (a deposit taken before invoicing) to a quote. When the
-- quote is converted, its deposits move to the invoice.
CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
  received_on TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'check', 'card', 'venmo', 'paypal', 'zelle', 'bank_transfer', 'other')),
  check_number TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  is_deposit INTEGER NOT NULL DEFAULT 0,
  voided_at TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (invoice_id IS NOT NULL OR quote_id IS NOT NULL)
);
CREATE INDEX payments_invoice ON payments (invoice_id);
CREATE INDEX payments_quote ON payments (quote_id);
CREATE INDEX payments_customer ON payments (customer_id);
CREATE INDEX payments_received ON payments (received_on);
