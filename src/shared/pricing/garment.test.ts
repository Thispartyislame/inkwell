import { describe, expect, it } from 'vitest'
import { garmentPrice, markupTierFor } from './garment'

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
