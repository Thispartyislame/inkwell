import { describe, expect, it } from 'vitest'
import type { PricingRulesInput } from '../schemas'
import { designKey, imprintSummary, priceQuote } from './engine'
import type { FeeInput, ImprintInput, LineInput, MatrixForPricing, PricingContext, QuotePricingInput } from './types'

// ---------- fixtures ----------
const rules: PricingRulesInput = {
  markup_mode: 'percent',
  markup_tiers: [{ up_to_cents: null, value: 10000 }], // ×2
  underbase_mode: 'plus_one_color',
  underbase_adder_cents: 75,
  specialty_adders: { puff: 50, glow: 0, metallic: 0, discharge: 0, water_based: 0, high_density: 0 },
  oversize_adders: { oversized: 50, jumbo: 100 },
  size_upcharges: { base: 0, '2xl': 200, '3xl': 300, '4xl_plus': 400 },
  min_order_qty: 12,
  below_min_fee_cents: 2500,
  rush_mode: 'percent',
  rush_value: 2500,
  screen_fee_cents: 2000,
  screen_fee_basis: 'per_screen',
  reorder_screen_discount_bp: 5000,
  digitizing_fee_cents: 4000
}

const screenMatrix: MatrixForPricing = {
  id: 1,
  name: 'Screen',
  method: 'screen',
  column_kind: 'colors',
  breaks: [12, 24, 48],
  columns: [1, 2, 3].map((value) => ({ value, label: '' })),
  prices: [
    [500, 600, 700],
    [400, 500, 600],
    [300, 400, 500]
  ],
  above_max_rule: 'per_extra_color',
  above_max_adder_cents: 50,
  is_default: true
}
const embMatrix: MatrixForPricing = {
  id: 2,
  name: 'Emb',
  method: 'embroidery',
  column_kind: 'stitches',
  breaks: [6, 24],
  columns: [5000, 10000, 15000].map((value) => ({ value, label: '' })),
  prices: [
    [800, 1000, 1200],
    [600, 800, 1000]
  ],
  above_max_rule: 'per_extra_color',
  above_max_adder_cents: 75,
  is_default: true
}

const ctx = (over: Partial<PricingContext> = {}): PricingContext => ({
  rules,
  matrices: [screenMatrix, embMatrix],
  rounding_mode: 'cent',
  combine_quantities: true,
  ink_labor_cost_per_piece_cents: 0,
  tax_bp: 800,
  customer: null,
  auto_fee_taxable: { screens: true, digitizing: true, below_min: true, rush: true },
  today: '2026-11-21',
  ...over
})

let uid = 0
const imprint = (over: Partial<ImprintInput> = {}): ImprintInput => ({
  uid: `i${++uid}`,
  location: 'front',
  location_custom: '',
  method: 'screen',
  colors: 1,
  underbase: false,
  specialty: [],
  print_size: 'standard',
  stitch_count: 0,
  new_digitizing: false,
  transfer_size: 1,
  is_reorder: false,
  matrix_id: null,
  ...over
})
const costs = { base: 250, '2xl': 400, '3xl': 500, '4xl_plus': 600 }
const line = (sizes: Record<string, number>, imprints: ImprintInput[] = [imprint()], over: Partial<LineInput> = {}): LineInput => ({
  uid: `l${++uid}`,
  costs,
  customer_supplied: false,
  sizes: Object.entries(sizes).map(([size, qty]) => ({ size, qty })),
  imprints,
  overrides: {},
  ...over
})
const quote = (lines: LineInput[], over: Partial<QuotePricingInput> = {}): QuotePricingInput => ({
  lines,
  fees: [],
  disabled_auto_fees: [],
  discount_mode: 'percent',
  discount_value: 0,
  rush: false,
  deposit_bp: 5000,
  charge_tax_anyway: false,
  amount_paid_cents: 0,
  ...over
})
const fee = (over: Partial<FeeInput>): FeeInput => ({ uid: `f${++uid}`, name: 'Fee', kind: 'other', basis: 'per_job', quantity: null, amount_cents: 1000, taxable: true, ...over })
const unit = (b: ReturnType<typeof priceQuote>, li = 0, gi = 0) => b.lines[li].groups[gi].unit_cents
const noScreens = { disabled_auto_fees: ['screens' as const] }

// ---------- tests ----------
describe('quantity breaks', () => {
  it.each([
    [11, 1000], // below the first break: priced at 12, garment 500 + print 500
    [12, 1000],
    [23, 1000],
    [24, 900],
    [47, 900],
    [48, 800],
    [500, 800]
  ])('%i pieces → %i per piece', (qty, expected) => {
    expect(unit(priceQuote(quote([line({ M: qty })]), ctx()))).toBe(expected)
  })
  it('warns below the smallest break', () => {
    const b = priceQuote(quote([line({ M: 6 })]), ctx())
    expect(b.warnings.map((w) => w.code)).toContain('below_matrix_min')
    expect(b.lines[0].imprints[0].break_qty).toBe(12)
  })
})

describe('colors above the matrix', () => {
  it('per extra color adds the adder for each color past the last column', () => {
    const b = priceQuote(quote([line({ M: 24 }, [imprint({ colors: 5 })])]), ctx())
    expect(b.lines[0].decoration_per_piece_cents).toBe(600 + 2 * 50)
  })
  it('use last column', () => {
    const b = priceQuote(quote([line({ M: 24 }, [imprint({ colors: 5 })])]), ctx({ matrices: [{ ...screenMatrix, above_max_rule: 'use_last' }] }))
    expect(b.lines[0].decoration_per_piece_cents).toBe(600)
    expect(b.warnings.find((w) => w.code === 'above_matrix_max')?.severity).toBe('info')
  })
  it('not allowed warns', () => {
    const b = priceQuote(quote([line({ M: 24 }, [imprint({ colors: 4 })])]), ctx({ matrices: [{ ...screenMatrix, above_max_rule: 'not_allowed' }] }))
    expect(b.warnings.find((w) => w.code === 'above_matrix_max')?.severity).toBe('warn')
  })
  it('stitches above the last band count each extra 1,000', () => {
    const b = priceQuote(quote([line({ M: 24 }, [imprint({ method: 'embroidery', stitch_count: 17001 })])]), ctx())
    expect(b.lines[0].decoration_per_piece_cents).toBe(1000 + 3 * 75)
  })
  it('stitch bands round up to the next column', () => {
    const b = priceQuote(quote([line({ M: 24 }, [imprint({ method: 'embroidery', stitch_count: 7000 })])]), ctx())
    expect(b.lines[0].decoration_per_piece_cents).toBe(800)
  })
})

describe('underbase', () => {
  it('counts as one more color', () => {
    const b = priceQuote(quote([line({ M: 24 }, [imprint({ colors: 2, underbase: true })])]), ctx())
    expect(b.lines[0].decoration_per_piece_cents).toBe(600) // 3-color column
    expect(b.screens).toBe(3)
  })
  it('or a flat adder', () => {
    const b = priceQuote(quote([line({ M: 24 }, [imprint({ colors: 2, underbase: true })])]), ctx({ rules: { ...rules, underbase_mode: 'flat_adder' } }))
    expect(b.lines[0].decoration_per_piece_cents).toBe(500 + 75)
    expect(b.screens).toBe(3) // still needs its own screen
  })
})

describe('adders and size upcharges', () => {
  it('specialty and oversize adders', () => {
    const b = priceQuote(quote([line({ M: 24 }, [imprint({ specialty: ['puff'], print_size: 'jumbo' })])]), ctx())
    expect(b.lines[0].decoration_per_piece_cents).toBe(400 + 50 + 100)
  })
  it('prices each size group with its own cost and upcharge', () => {
    const b = priceQuote(quote([line({ M: 20, '2XL': 2, '3XL': 1, '5XL': 1 })], noScreens), ctx())
    // 24 pieces → print 400
    expect(b.lines[0].groups.map((g) => [g.group, g.qty, g.unit_cents])).toEqual([
      ['base', 20, 500 + 400],
      ['2xl', 2, 800 + 400 + 200],
      ['3xl', 1, 1000 + 400 + 300],
      ['4xl_plus', 1, 1200 + 400 + 400]
    ])
    expect(b.lines[0].total_cents).toBe(20 * 900 + 2 * 1400 + 1700 + 2000)
  })
  it('customer-supplied garments: no garment price and no upcharge', () => {
    const b = priceQuote(quote([line({ M: 20, '2XL': 4 }, [imprint()], { customer_supplied: true })], noScreens), ctx())
    expect(b.lines[0].groups.map((g) => g.unit_cents)).toEqual([400, 400])
    expect(b.cost_cents).toBe(0)
  })
})

describe('combining quantities', () => {
  it('lines with identical imprints share the quantity break', () => {
    const b = priceQuote(quote([line({ M: 12 }, [imprint()]), line({ M: 12 }, [imprint()])]), ctx())
    expect(b.lines.map((l) => l.priced_qty)).toEqual([24, 24])
    expect(unit(b, 0)).toBe(900)
  })
  it('different imprints do not combine', () => {
    const b = priceQuote(quote([line({ M: 12 }, [imprint()]), line({ M: 12 }, [imprint({ colors: 2 })])]), ctx())
    expect(b.lines.map((l) => l.priced_qty)).toEqual([12, 12])
  })
  it('the setting can turn combining off', () => {
    const b = priceQuote(quote([line({ M: 12 }), line({ M: 12 })]), ctx({ combine_quantities: false }))
    expect(b.lines.map((l) => l.priced_qty)).toEqual([12, 12])
  })
  it('imprint order does not matter for the design key', () => {
    const a = [imprint({ location: 'front' }), imprint({ location: 'back', colors: 2 })]
    expect(designKey(a)).toBe(designKey([a[1], a[0]]))
  })
})

describe('screens and auto fees', () => {
  it('screens are counted once per design across shirt colors', () => {
    const imps = () => [imprint({ colors: 3 }), imprint({ location: 'back', colors: 1 })]
    const b = priceQuote(quote([line({ M: 24 }, imps()), line({ L: 24 }, imps())]), ctx())
    expect(b.screens).toBe(4)
    expect(b.fees.find((f) => f.key === 'auto:screens')?.amount_cents).toBe(4 * 2000)
  })
  it('reorder screens get the discount', () => {
    const b = priceQuote(quote([line({ M: 24 }, [imprint({ colors: 2, is_reorder: true })])]), ctx())
    expect(b.fees.find((f) => f.key === 'auto:screens')?.amount_cents).toBe(2 * 1000)
  })
  it('per-color basis does not charge for the underbase', () => {
    const b = priceQuote(quote([line({ M: 24 }, [imprint({ colors: 2, underbase: true })])]), ctx({ rules: { ...rules, screen_fee_basis: 'per_color' } }))
    expect(b.fees.find((f) => f.key === 'auto:screens')?.amount_cents).toBe(2 * 2000)
  })
  it('auto fees can be waived', () => {
    const b = priceQuote(quote([line({ M: 24 })], noScreens), ctx())
    expect(b.fees).toEqual([])
  })
  it('digitizing once per new embroidery design', () => {
    const e = () => imprint({ method: 'embroidery', stitch_count: 6000, new_digitizing: true, location: 'left_chest' })
    const b = priceQuote(quote([line({ M: 12 }, [e()]), line({ M: 12 }, [e()])]), ctx())
    expect(b.fees.find((f) => f.key === 'auto:digitizing')?.amount_cents).toBe(4000)
  })
  it('below-minimum fee', () => {
    const b = priceQuote(quote([line({ M: 6 })], noScreens), ctx())
    expect(b.fees.map((f) => [f.key, f.amount_cents])).toEqual([['auto:below_min', 2500]])
    expect(b.warnings.map((w) => w.code)).toContain('below_min_order')
  })
})

describe('totals, discounts and tax', () => {
  // 24 M at 900 = 21600 items, no screens
  it('percent discount comes off before tax', () => {
    const b = priceQuote(quote([line({ M: 24 })], { ...noScreens, discount_mode: 'percent', discount_value: 1000 }), ctx())
    expect(b.subtotal_cents).toBe(21600)
    expect(b.discount_cents).toBe(2160)
    expect(b.taxable_cents).toBe(19440)
    expect(b.tax_cents).toBe(1555) // 19440 × 8% = 1555.2
    expect(b.total_cents).toBe(19440 + 1555)
  })
  it('flat discount is capped at the subtotal', () => {
    const b = priceQuote(quote([line({ M: 24 })], { ...noScreens, discount_mode: 'flat', discount_value: 999999 }), ctx())
    expect(b.discount_cents).toBe(21600)
    expect(b.total_cents).toBe(0)
  })
  it('non-taxable fees are not taxed and the discount is split pro-rata', () => {
    const b = priceQuote(quote([line({ M: 24 })], { ...noScreens, fees: [fee({ amount_cents: 2400, taxable: false })], discount_mode: 'flat', discount_value: 2400 }), ctx())
    // subtotal 24000, taxable 21600 (90%) → discount share 2160 → taxable 19440
    expect(b.subtotal_cents).toBe(24000)
    expect(b.taxable_cents).toBe(19440)
    expect(b.tax_cents).toBe(1555)
  })
  it('per-piece and per-hour fees', () => {
    const b = priceQuote(quote([line({ M: 24 })], { ...noScreens, fees: [fee({ basis: 'per_piece', amount_cents: 75 }), fee({ basis: 'per_hour', quantity: 2, amount_cents: 6000 })] }), ctx())
    expect(b.fees.map((f) => f.amount_cents)).toEqual([24 * 75, 12000])
  })
  it('rush applies after the discount', () => {
    const b = priceQuote(quote([line({ M: 24 })], { ...noScreens, rush: true, discount_mode: 'percent', discount_value: 1000 }), ctx())
    expect(b.rush_cents).toBe(4860) // 25% of 19440
    expect(b.taxable_cents).toBe(19440 + 4860)
  })
  it('shipping is added after tax and untaxed unless marked taxable', () => {
    const ship = fee({ kind: 'shipping', amount_cents: 1500, taxable: false })
    const b = priceQuote(quote([line({ M: 24 })], { ...noScreens, fees: [ship] }), ctx())
    expect(b.subtotal_cents).toBe(21600)
    expect(b.shipping_cents).toBe(1500)
    expect(b.tax_cents).toBe(1728)
    expect(b.total_cents).toBe(21600 + 1728 + 1500)
    const taxed = priceQuote(quote([line({ M: 24 })], { ...noScreens, fees: [{ ...ship, taxable: true }] }), ctx())
    expect(taxed.tax_cents).toBe(1848) // (21600 + 1500) × 8%
  })
  it('deposit and balance', () => {
    const b = priceQuote(quote([line({ M: 24 })], { ...noScreens, deposit_bp: 5000, amount_paid_cents: 5000 }), ctx())
    expect(b.total_cents).toBe(23328)
    expect(b.deposit_cents).toBe(11664)
    expect(b.balance_cents).toBe(18328)
  })
})

describe('tax-exempt customers', () => {
  const exempt = (expires: string | null) => ctx({ customer: { tax_exempt: true, exempt_cert_expires_on: expires, pricing_matrix_id: null } })
  it('no tax with a valid certificate', () => {
    const b = priceQuote(quote([line({ M: 24 })], noScreens), exempt('2027-01-01'))
    expect(b.tax_cents).toBe(0)
    expect(b.tax_exempt_applied).toBe(true)
    expect(b.warnings).toEqual([])
  })
  it('expired certificate: still exempt but warns', () => {
    const b = priceQuote(quote([line({ M: 24 })], noScreens), exempt('2026-01-01'))
    expect(b.tax_cents).toBe(0)
    expect(b.warnings.map((w) => w.code)).toEqual(['exempt_cert_expired'])
  })
  it('“charge tax anyway” charges it', () => {
    const b = priceQuote(quote([line({ M: 24 })], { ...noScreens, charge_tax_anyway: true }), exempt('2026-01-01'))
    expect(b.tax_cents).toBe(1728)
  })
})

describe('rounding and overrides', () => {
  const odd = { ...costs, base: 233 } // garment 466 + print 400 = 866
  it.each([
    ['cent', 866],
    ['nickel', 865],
    ['quarter', 875]
  ] as const)('%s', (mode, expected) => {
    expect(unit(priceQuote(quote([line({ M: 24 }, [imprint()], { costs: odd })]), ctx({ rounding_mode: mode })))).toBe(expected)
  })
  it('manual override replaces the unit price and is flagged', () => {
    const b = priceQuote(quote([line({ M: 20, '2XL': 4 }, [imprint()], { overrides: { base: 750 } })], noScreens), ctx())
    const [base, xxl] = b.lines[0].groups
    expect(base).toMatchObject({ unit_cents: 750, calculated_unit_cents: 900, overridden: true, total_cents: 15000 })
    expect(xxl.overridden).toBe(false)
    expect(b.warnings.map((w) => w.code)).toContain('unit_override')
  })
})

describe('edge cases', () => {
  it('empty quote', () => {
    const b = priceQuote(quote([]), ctx())
    expect(b.total_cents).toBe(0)
    expect(b.fees).toEqual([])
    expect(b.margin_bp).toBeNull()
  })
  it('zero quantities price nothing and charge no screens', () => {
    const b = priceQuote(quote([line({ M: 0, L: 0 })]), ctx())
    expect(b.lines[0].groups).toEqual([])
    expect(b.total_cents).toBe(0)
    expect(b.fees).toEqual([])
    expect(b.warnings.map((w) => w.code)).toEqual(['no_quantity'])
  })
  it('missing matrix warns and prices only adders', () => {
    const b = priceQuote(quote([line({ M: 24 }, [imprint({ method: 'dtf' })])]), ctx())
    expect(b.warnings.map((w) => w.code)).toContain('no_matrix')
    expect(b.lines[0].decoration_per_piece_cents).toBe(0)
  })
  it('blank garments without imprints', () => {
    const b = priceQuote(quote([line({ M: 24 }, [])]), ctx())
    expect(unit(b)).toBe(500)
    expect(b.warnings.map((w) => w.code)).toContain('no_imprints')
  })
  it('customer default matrix is used for its method', () => {
    const cheap = { ...screenMatrix, id: 9, name: 'Cheap', is_default: false, prices: screenMatrix.prices.map((r) => r.map((p) => p - 100)) }
    const b = priceQuote(quote([line({ M: 24 })]), ctx({ matrices: [screenMatrix, cheap], customer: { tax_exempt: false, exempt_cert_expires_on: null, pricing_matrix_id: 9 } }))
    expect(b.lines[0].imprints[0].matrix_name).toBe('Cheap')
  })
  it('profit and margin', () => {
    const b = priceQuote(quote([line({ M: 24 })], noScreens), ctx({ ink_labor_cost_per_piece_cents: 100 }))
    // revenue 21600, cost 24 × 250 + 24 × 100 = 8400
    expect(b.profit_cents).toBe(13200)
    expect(b.margin_bp).toBe(6111)
  })
})

describe('imprintSummary', () => {
  it('describes imprints for documents', () => {
    expect(imprintSummary(imprint({ colors: 3, underbase: true }))).toBe('Front – 3 colors + underbase')
    expect(imprintSummary(imprint({ location: 'left_chest', method: 'embroidery', stitch_count: 6500 }))).toBe('Left chest – embroidery, 6,500 stitches')
    expect(imprintSummary(imprint({ location: 'custom', location_custom: 'Hood', colors: 1, specialty: ['puff'] }))).toBe('Hood – 1 color (puff)')
  })
})
