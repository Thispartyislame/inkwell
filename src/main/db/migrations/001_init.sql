-- Phase 1 schema: settings, customers, catalog, pricing setup, attachments, activity.
-- Money columns end in _cents (INTEGER). Rates end in _bp (basis points, 825 = 8.25%).
-- JSON columns are TEXT and validated in the app on read and write.

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  shop_name TEXT NOT NULL DEFAULT '',
  logo_path TEXT,
  address_line1 TEXT NOT NULL DEFAULT '',
  address_line2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'US',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  tax_id TEXT NOT NULL DEFAULT '',
  default_tax_bp INTEGER NOT NULL DEFAULT 0 CHECK (default_tax_bp >= 0),
  default_deposit_bp INTEGER NOT NULL DEFAULT 5000 CHECK (default_deposit_bp BETWEEN 0 AND 10000),
  quote_expiration_days INTEGER NOT NULL DEFAULT 30 CHECK (quote_expiration_days >= 0),
  payment_terms TEXT NOT NULL DEFAULT 'due_on_receipt',
  payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  quote_prefix TEXT NOT NULL DEFAULT 'Q-',
  quote_next_number INTEGER NOT NULL DEFAULT 1001 CHECK (quote_next_number >= 1),
  quote_last_issued INTEGER NOT NULL DEFAULT 0,
  invoice_prefix TEXT NOT NULL DEFAULT 'INV-',
  invoice_next_number INTEGER NOT NULL DEFAULT 1001 CHECK (invoice_next_number >= 1),
  invoice_last_issued INTEGER NOT NULL DEFAULT 0,
  receipt_prefix TEXT NOT NULL DEFAULT 'R-',
  receipt_next_number INTEGER NOT NULL DEFAULT 1001 CHECK (receipt_next_number >= 1),
  receipt_last_issued INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  accent_color TEXT NOT NULL DEFAULT '#2563eb',
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  pdf_footer_text TEXT NOT NULL DEFAULT '',
  terms_text TEXT NOT NULL DEFAULT '',
  how_to_pay_text TEXT NOT NULL DEFAULT '',
  rounding_mode TEXT NOT NULL DEFAULT 'cent' CHECK (rounding_mode IN ('cent', 'nickel', 'quarter')),
  combine_quantities INTEGER NOT NULL DEFAULT 1,
  ink_labor_cost_per_piece_cents INTEGER NOT NULL DEFAULT 0 CHECK (ink_labor_cost_per_piece_cents >= 0),
  smtp_host TEXT NOT NULL DEFAULT '',
  smtp_port INTEGER NOT NULL DEFAULT 587,
  smtp_secure INTEGER NOT NULL DEFAULT 0,
  smtp_user TEXT NOT NULL DEFAULT '',
  smtp_password_enc BLOB,
  smtp_from_name TEXT NOT NULL DEFAULT '',
  email_quote_subject TEXT NOT NULL DEFAULT 'Quote {quote_number} from {shop_name}',
  email_quote_body TEXT NOT NULL DEFAULT 'Hi {customer_first_name},

Attached is quote {quote_number} for {total}. It is good through {expiration_date}.

Reply to this email to approve it or ask any questions.

Thanks,
{shop_name}',
  email_invoice_subject TEXT NOT NULL DEFAULT 'Invoice {invoice_number} from {shop_name}',
  email_invoice_body TEXT NOT NULL DEFAULT 'Hi {customer_first_name},

Attached is invoice {invoice_number}. The balance due is {balance_due}.

Thanks for your business,
{shop_name}',
  email_receipt_subject TEXT NOT NULL DEFAULT 'Payment receipt from {shop_name}',
  email_receipt_body TEXT NOT NULL DEFAULT 'Hi {customer_first_name},

Thank you for your payment of {amount}. Your receipt is attached.

{shop_name}',
  setup_completed_at TEXT,
  last_backup_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO settings (id) VALUES (1);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  company_name TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  billing_line1 TEXT NOT NULL DEFAULT '',
  billing_line2 TEXT NOT NULL DEFAULT '',
  billing_city TEXT NOT NULL DEFAULT '',
  billing_state TEXT NOT NULL DEFAULT '',
  billing_postal_code TEXT NOT NULL DEFAULT '',
  shipping_same_as_billing INTEGER NOT NULL DEFAULT 1,
  shipping_line1 TEXT NOT NULL DEFAULT '',
  shipping_line2 TEXT NOT NULL DEFAULT '',
  shipping_city TEXT NOT NULL DEFAULT '',
  shipping_state TEXT NOT NULL DEFAULT '',
  shipping_postal_code TEXT NOT NULL DEFAULT '',
  tax_exempt INTEGER NOT NULL DEFAULT 0,
  exempt_cert_number TEXT NOT NULL DEFAULT '',
  exempt_cert_attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  exempt_cert_expires_on TEXT,
  pricing_matrix_id INTEGER REFERENCES pricing_matrices(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK (company_name <> '' OR first_name <> '' OR last_name <> '')
);
CREATE INDEX customers_company ON customers (company_name COLLATE NOCASE);
CREATE INDEX customers_last ON customers (last_name COLLATE NOCASE);
CREATE INDEX customers_email ON customers (email COLLATE NOCASE);

CREATE TABLE customer_contacts (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX customer_contacts_customer ON customer_contacts (customer_id);

CREATE TABLE garments (
  id INTEGER PRIMARY KEY,
  brand TEXT NOT NULL DEFAULT '',
  style_number TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'tee',
  supplier TEXT NOT NULL DEFAULT 'other',
  supplier_other TEXT NOT NULL DEFAULT '',
  colors TEXT NOT NULL DEFAULT '[]',
  sizes TEXT NOT NULL DEFAULT '[]',
  cost_base_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_base_cents >= 0),
  cost_2xl_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_2xl_cents >= 0),
  cost_3xl_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_3xl_cents >= 0),
  cost_4xl_plus_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_4xl_plus_cents >= 0),
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX garments_style ON garments (brand COLLATE NOCASE, style_number COLLATE NOCASE);

-- A matrix is a grid: rows are quantity breaks (minimum qty), columns are color counts
-- (screen print), stitch-count bands (embroidery) or size bands (DTF / transfers).
-- prices[row][col] = price per piece per location, in cents.
CREATE TABLE pricing_matrices (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('screen', 'embroidery', 'dtf', 'transfer', 'other')),
  column_kind TEXT NOT NULL CHECK (column_kind IN ('colors', 'stitches', 'size')),
  breaks TEXT NOT NULL DEFAULT '[]',
  columns TEXT NOT NULL DEFAULT '[]',
  prices TEXT NOT NULL DEFAULT '[]',
  above_max_rule TEXT NOT NULL DEFAULT 'per_extra_color' CHECK (above_max_rule IN ('use_last', 'per_extra_color', 'not_allowed')),
  above_max_adder_cents INTEGER NOT NULL DEFAULT 0 CHECK (above_max_adder_cents >= 0),
  is_default INTEGER NOT NULL DEFAULT 0,
  is_sample INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE pricing_rules (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  markup_mode TEXT NOT NULL DEFAULT 'percent' CHECK (markup_mode IN ('percent', 'multiplier')),
  markup_tiers TEXT NOT NULL DEFAULT '[]',
  underbase_mode TEXT NOT NULL DEFAULT 'plus_one_color' CHECK (underbase_mode IN ('plus_one_color', 'flat_adder')),
  underbase_adder_cents INTEGER NOT NULL DEFAULT 0 CHECK (underbase_adder_cents >= 0),
  specialty_adders TEXT NOT NULL DEFAULT '{}',
  oversize_adders TEXT NOT NULL DEFAULT '{}',
  size_upcharges TEXT NOT NULL DEFAULT '{}',
  min_order_qty INTEGER NOT NULL DEFAULT 0 CHECK (min_order_qty >= 0),
  below_min_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (below_min_fee_cents >= 0),
  rush_mode TEXT NOT NULL DEFAULT 'percent' CHECK (rush_mode IN ('percent', 'flat')),
  rush_value INTEGER NOT NULL DEFAULT 0 CHECK (rush_value >= 0),
  screen_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (screen_fee_cents >= 0),
  screen_fee_basis TEXT NOT NULL DEFAULT 'per_screen' CHECK (screen_fee_basis IN ('per_screen', 'per_color')),
  reorder_screen_discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (reorder_screen_discount_bp BETWEEN 0 AND 10000),
  digitizing_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (digitizing_fee_cents >= 0),
  is_sample INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE fee_presets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('screen', 'film', 'digitizing', 'art', 'shipping', 'rush', 'other')),
  basis TEXT NOT NULL DEFAULT 'per_job' CHECK (basis IN ('per_job', 'per_piece', 'per_hour')),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  taxable INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE inks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  pms TEXT NOT NULL DEFAULT '',
  hex TEXT NOT NULL DEFAULT '#000000',
  type TEXT NOT NULL DEFAULT 'plastisol' CHECK (type IN ('plastisol', 'water_based', 'discharge', 'specialty')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('quote', 'invoice', 'customer', 'separation', 'settings')),
  owner_id INTEGER NOT NULL,
  rel_path TEXT NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('mockup', 'artwork', 'proof', 'tax_cert', 'film', 'logo', 'other')),
  caption TEXT NOT NULL DEFAULT '',
  include_in_pdf INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX attachments_owner ON attachments (owner_type, owner_id);

CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX activity_entity ON activity_log (entity_type, entity_id);
