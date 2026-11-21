import { describe, expect, it } from 'vitest'
import { convertMarkupValue, garmentGroupPrices, garmentPrice, marginBp, markupTierFor } from './garment'

const tiers = [
  { up_to_cents: 500, value: 10000 },
  { up_to_cents: 1500, value: 7500 },
  { up_to_cents: null, value: 5000 }
]

describe('garment markup', () => {
  it('picks tiers by cost, inclusive of the limit', () => {
    expect(markupTierFor(500, tiers).value).toBe(10000)
    expect(markupTierFor(501, tiers).value).toBe(7500)
    expect(markupTierFor(99999, tiers).value).toBe(5000)
  })
  it('percent markup', () => {
    expect(garmentPrice(250, { markup_mode: 'percent', markup_tiers: tiers })).toBe(500)
    expect(garmentPrice(1050, { markup_mode: 'percent', markup_tiers: tiers })).toBe(1838) // 1050 × 1.75 = 1837.5 → 1838
    expect(garmentPrice(2000, { markup_mode: 'percent', markup_tiers: tiers })).toBe(3000)
  })
  it('multiplier markup', () => {
    expect(garmentPrice(333, { markup_mode: 'multiplier', markup_tiers: [{ up_to_cents: null, value: 1500 }] })).toBe(500) // 499.5 → 500
  })
  it('free garments (customer supplied) stay free', () => {
    expect(garmentPrice(0, { markup_mode: 'percent', markup_tiers: tiers })).toBe(0)
  })
})

describe('margin pricing', () => {
  const margin = (value: number) => ({ markup_mode: 'margin' as const, markup_tiers: [{ up_to_cents: null, value }] })
  it('prices to a target margin', () => {
    expect(garmentPrice(300, margin(4000))).toBe(500) // 3.00 / 0.60
    expect(garmentPrice(250, margin(5000))).toBe(500)
    expect(garmentPrice(100, margin(3000))).toBe(143) // 142.857 → 143
    expect(garmentPrice(0, margin(4000))).toBe(0)
  })
  it('hits the target margin within a cent', () => {
    for (const cost of [199, 250, 375, 1050, 2999]) {
      const sell = garmentPrice(cost, margin(4000))
      expect(Math.abs(marginBp(cost, sell)! - 4000)).toBeLessThanOrEqual(Math.ceil(10000 / sell))
    }
  })
  it('margin of a sale', () => {
    expect(marginBp(300, 500)).toBe(4000)
    expect(marginBp(500, 500)).toBe(0)
    expect(marginBp(600, 500)).toBe(-2000)
    expect(marginBp(100, 0)).toBeNull()
  })
  it('converts tier values between modes', () => {
    expect(convertMarkupValue(10000, 'percent', 'margin')).toBe(5000) // +100% = 50% margin
    expect(convertMarkupValue(5000, 'margin', 'percent')).toBe(10000)
    expect(convertMarkupValue(4000, 'margin', 'multiplier')).toBe(1667)
    expect(convertMarkupValue(2000, 'multiplier', 'percent')).toBe(10000)
    expect(convertMarkupValue(5000, 'percent', 'percent')).toBe(5000)
  })
})

describe('garmentGroupPrices', () => {
  it('shows cost, sell price and margin per size group', () => {
    const rows = garmentGroupPrices(
      { base: 250, '2xl': 425, '3xl': 525, '4xl_plus': 0 },
      { markup_mode: 'percent', markup_tiers: tiers, size_upcharges: { base: 0, '2xl': 200, '3xl': 300, '4xl_plus': 400 } }
    )
    expect(rows.map((r) => [r.group, r.costCents, r.sellCents, r.marginBp])).toEqual([
      ['base', 250, 500, 5000],
      ['2xl', 425, 1050, 5952], // 850 + 200 upcharge
      ['3xl', 525, 1219, 5693], // 525 × 1.75 = 918.75 → 919, + 300
      ['4xl_plus', 0, 0, null] // no cost entered: nothing sold, no upcharge
    ])
  })
})
