-- Allow pricing garments by target margin. SQLite can't change a CHECK constraint in place,
-- so the single-row pricing_rules table is rebuilt with the new allowed value.
CREATE TABLE pricing_rules_new (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  markup_mode TEXT NOT NULL DEFAULT 'percent' CHECK (markup_mode IN ('percent', 'multiplier', 'margin')),
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
INSERT INTO pricing_rules_new SELECT * FROM pricing_rules;
DROP TABLE pricing_rules;
ALTER TABLE pricing_rules_new RENAME TO pricing_rules;
