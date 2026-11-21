import type Database from 'better-sqlite3'
import type { GarmentInput, PricingMatrixInput, PricingRulesInput } from '@shared/schemas'
import { colorFromName } from '@shared/colors'
import { insert, toRow } from './rows'

/**
 * Example pricing so the app is usable on first launch. Everything here is flagged
 * is_sample and shown with a "Sample: edit these to match your pricing" badge until edited.
 */

const c = (dollars: number[]) => dollars.map((d) => Math.round(d * 100))

const MATRICES: PricingMatrixInput[] = [
  {
    name: 'Standard Screen Print',
    method: 'screen',
    column_kind: 'colors',
    breaks: [12, 24, 48, 72, 144, 288, 500, 1000],
    columns: [1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: '' })),
    prices: [
      c([4.5, 5.5, 6.5, 7.5, 8.5, 9.5]),
      c([3.25, 4.0, 4.75, 5.5, 6.25, 7.0]),
      c([2.5, 3.0, 3.6, 4.2, 4.8, 5.4]),
      c([2.1, 2.55, 3.0, 3.5, 4.0, 4.5]),
      c([1.7, 2.05, 2.45, 2.85, 3.25, 3.65]),
      c([1.4, 1.7, 2.0, 2.35, 2.7, 3.0]),
      c([1.2, 1.45, 1.7, 2.0, 2.3, 2.6]),
      c([1.0, 1.2, 1.45, 1.7, 1.95, 2.2])
    ],
    above_max_rule: 'per_extra_color',
    above_max_adder_cents: 35,
    is_default: true,
    notes: 'Price per piece, per print location.'
  },
  {
    name: 'Contract Print (customer-supplied garments)',
    method: 'screen',
    column_kind: 'colors',
    breaks: [48, 72, 144, 288, 500, 1000],
    columns: [1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: '' })),
    prices: [
      c([2.75, 3.3, 3.95, 4.6, 5.25, 5.9]),
      c([2.3, 2.8, 3.3, 3.85, 4.4, 4.95]),
      c([1.85, 2.25, 2.7, 3.1, 3.55, 4.0]),
      c([1.55, 1.85, 2.2, 2.6, 2.95, 3.3]),
      c([1.3, 1.6, 1.85, 2.2, 2.5, 2.85]),
      c([1.1, 1.3, 1.6, 1.85, 2.15, 2.4])
    ],
    above_max_rule: 'per_extra_color',
    above_max_adder_cents: 40,
    is_default: false,
    notes: 'For garments the customer brings in. Includes handling of customer goods.'
  },
  {
    name: 'Embroidery',
    method: 'embroidery',
    column_kind: 'stitches',
    breaks: [6, 12, 24, 48, 72, 144],
    columns: [
      { value: 5000, label: '' },
      { value: 8000, label: '' },
      { value: 10000, label: '' },
      { value: 15000, label: '' }
    ],
    prices: [c([9, 11, 12.5, 15]), c([7.5, 9, 10.5, 13]), c([6.5, 8, 9, 11.5]), c([5.5, 7, 8, 10]), c([5, 6.25, 7.25, 9]), c([4.5, 5.5, 6.5, 8])],
    above_max_rule: 'per_extra_color',
    above_max_adder_cents: 75,
    is_default: true,
    notes: 'Above the last column: adder per extra 1,000 stitches.'
  },
  {
    name: 'DTF Transfers',
    method: 'dtf',
    column_kind: 'size',
    breaks: [1, 12, 24, 48, 100],
    columns: [
      { value: 1, label: 'Small (up to 4")' },
      { value: 2, label: 'Medium (up to 10")' },
      { value: 3, label: 'Large (up to 12×16")' }
    ],
    prices: [c([6, 9, 12]), c([4.5, 7, 9.5]), c([3.75, 6, 8]), c([3, 5, 7]), c([2.5, 4.25, 6])],
    above_max_rule: 'use_last',
    above_max_adder_cents: 0,
    is_default: true,
    notes: ''
  }
]

const RULES: PricingRulesInput = {
  markup_mode: 'percent',
  markup_tiers: [
    { up_to_cents: 500, value: 10000 },
    { up_to_cents: 1500, value: 7500 },
    { up_to_cents: null, value: 5000 }
  ],
  underbase_mode: 'plus_one_color',
  underbase_adder_cents: 50,
  specialty_adders: { puff: 50, glow: 50, metallic: 35, discharge: 25, water_based: 15, high_density: 75 },
  oversize_adders: { oversized: 50, jumbo: 100 },
  size_upcharges: { base: 0, '2xl': 200, '3xl': 300, '4xl_plus': 400 },
  min_order_qty: 12,
  below_min_fee_cents: 2500,
  rush_mode: 'percent',
  rush_value: 2500,
  screen_fee_cents: 2500,
  screen_fee_basis: 'per_screen',
  reorder_screen_discount_bp: 5000,
  digitizing_fee_cents: 4000
}

const FEES: Array<[string, string, string, number, boolean]> = [
  ['Screen Setup', 'screen', 'per_job', 2500, true],
  ['Film Output', 'film', 'per_job', 1000, true],
  ['Digitizing', 'digitizing', 'per_job', 4000, true],
  ['Art Time', 'art', 'per_hour', 6000, true],
  ['Color Change', 'other', 'per_job', 1500, true],
  ['Ink Change', 'other', 'per_job', 1500, true],
  ['Pantone Match', 'other', 'per_job', 2000, true],
  ['Fold & Bag', 'other', 'per_piece', 75, true],
  ['Individual Names/Numbers', 'other', 'per_piece', 500, true],
  ['Shipping', 'shipping', 'per_job', 0, false],
  ['Rush', 'rush', 'per_job', 0, true]
]

const INKS: Array<[string, string, string, string]> = [
  ['Black', 'Black C', '#101820', 'plastisol'],
  ['White', '', '#ffffff', 'plastisol'],
  ['Underbase White', '', '#f4f4f4', 'plastisol'],
  ['Athletic Gold', 'PMS 123 C', '#ffc72c', 'plastisol'],
  ['Royal Blue', 'PMS 286 C', '#0033a0', 'plastisol'],
  ['Navy', 'PMS 289 C', '#0c2340', 'plastisol'],
  ['Red', 'PMS 186 C', '#c8102e', 'plastisol'],
  ['Kelly Green', 'PMS 348 C', '#00843d', 'plastisol'],
  ['Orange', 'PMS 021 C', '#fe5000', 'plastisol'],
  ['Grey', 'Cool Gray 8 C', '#888b8d', 'plastisol']
]

const garment = (brand: string, style: string, name: string, category: GarmentInput['category'], supplier: GarmentInput['supplier'], colors: string[], sizes: string[], costs: number[]): GarmentInput => ({
  brand,
  style_number: style,
  name,
  category,
  supplier,
  supplier_other: '',
  colors: colors.map(colorFromName),
  sizes,
  cost_base_cents: costs[0],
  cost_2xl_cents: costs[1],
  cost_3xl_cents: costs[2],
  cost_4xl_plus_cents: costs[3],
  notes: 'Sample garment with example costs. Edit or archive it.',
  active: true
})

const GARMENTS: GarmentInput[] = [
  garment('Gildan', '5000', 'Heavy Cotton T-Shirt', 'tee', 'ss_activewear', ['White', 'Black', 'Navy', 'Sport Grey', 'Red', 'Royal'], ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'], [250, 425, 525, 575]),
  garment('Bella+Canvas', '3001', 'Unisex Jersey Tee', 'tee', 'ss_activewear', ['White', 'Black', 'Athletic Heather', 'Navy', 'Dark Heather'], ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'], [375, 525, 650, 750]),
  garment('Gildan', '18500', 'Heavy Blend Hooded Sweatshirt', 'hoodie', 'sanmar', ['Black', 'Navy', 'Sport Grey', 'Charcoal', 'Maroon'], ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'], [1050, 1350, 1500, 1650])
]

export function seedIfEmpty(db: Database.Database): boolean {
  const has = db.prepare('SELECT COUNT(*) AS n FROM pricing_rules').get() as { n: number }
  if (has.n > 0) return false
  db.transaction(() => {
    for (const m of MATRICES) insert(db, 'pricing_matrices', { ...toRow(m, { json: ['breaks', 'columns', 'prices'] }), is_sample: 1 })
    insert(db, 'pricing_rules', { ...toRow(RULES, { json: ['markup_tiers', 'specialty_adders', 'oversize_adders', 'size_upcharges'] }), is_sample: 1 })
    FEES.forEach(([name, kind, basis, amount, taxable], i) =>
      insert(db, 'fee_presets', { name, kind, basis, amount_cents: amount, taxable: taxable ? 1 : 0, sort_order: i, is_sample: 1 })
    )
    for (const [name, pms, hex, type] of INKS) insert(db, 'inks', { name, pms, hex, type })
    for (const g of GARMENTS) insert(db, 'garments', toRow(g, { bool: ['active'], json: ['colors', 'sizes'] }))
  })()
  return true
}
