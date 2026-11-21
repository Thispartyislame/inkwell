import { applyBp, BP_PER_UNIT, divRound, type Cents } from '../money'
import type { MarkupMode, MarkupTier, PricingRulesInput } from '../schemas'
import { SIZE_GROUPS, type SizeGroup } from '../sizes'

/** The markup tier for a garment cost: the first tier whose limit is at or above the cost. */
export function markupTierFor(costCents: Cents, tiers: MarkupTier[]): MarkupTier {
  if (!tiers.length) throw new Error('No markup tiers configured')
  return tiers.find((t) => t.up_to_cents === null || costCents <= t.up_to_cents) ?? tiers[tiers.length - 1]
}

/**
 * Garment selling price before decoration and size upcharges, rounded half up to the cent.
 * percent:    cost + cost × markup          (value in bp: 10000 = +100%)
 * multiplier: cost × multiplier             (value × 1000: 1800 = ×1.8)
 * margin:     cost ÷ (1 − target margin)    (value in bp: 4000 = 40% of the sell price is profit)
 */
export function garmentPrice(costCents: Cents, rules: Pick<PricingRulesInput, 'markup_mode' | 'markup_tiers'>): Cents {
  if (costCents <= 0) return 0
  const { value } = markupTierFor(costCents, rules.markup_tiers)
  switch (rules.markup_mode) {
    case 'percent':
      return costCents + applyBp(costCents, value)
    case 'multiplier':
      return divRound(costCents * value, 1000)
    case 'margin':
      if (value >= BP_PER_UNIT) throw new RangeError('Margin must be below 100%')
      return divRound(costCents * BP_PER_UNIT, BP_PER_UNIT - value)
  }
}

/** Gross margin of a sale in basis points: (sell − cost) ÷ sell. Null when nothing is sold. */
export function marginBp(costCents: Cents, sellCents: Cents): number | null {
  if (sellCents <= 0) return null
  return divRound((sellCents - costCents) * BP_PER_UNIT, sellCents)
}

/**
 * Convert a tier value between modes so the effective price stays (about) the same.
 * Goes through the price/cost ratio; the result is rounded to the target mode's unit.
 */
export function convertMarkupValue(value: number, from: MarkupMode, to: MarkupMode): number {
  if (from === to) return value
  const ratio = from === 'percent' ? 1 + value / BP_PER_UNIT : from === 'multiplier' ? value / 1000 : 1 / (1 - Math.min(value, 9499) / BP_PER_UNIT)
  if (to === 'percent') return Math.max(0, Math.round((ratio - 1) * BP_PER_UNIT))
  if (to === 'multiplier') return Math.max(0, Math.round(ratio * 1000))
  return Math.min(9400, Math.max(0, Math.round((1 - 1 / ratio) * BP_PER_UNIT)))
}

export interface GarmentGroupPrice {
  group: SizeGroup
  costCents: Cents
  /** marked-up garment price */
  markedUpCents: Cents
  upchargeCents: Cents
  /** what the customer pays for the blank garment: marked up + size upcharge */
  sellCents: Cents
  profitCents: Cents
  marginBp: number | null
}

/** Cost, sell price and margin of a blank garment per size group (no decoration). */
export function garmentGroupPrices(
  costs: Record<SizeGroup, Cents>,
  rules: Pick<PricingRulesInput, 'markup_mode' | 'markup_tiers' | 'size_upcharges'>
): GarmentGroupPrice[] {
  return SIZE_GROUPS.map((group) => {
    const costCents = costs[group]
    const markedUpCents = garmentPrice(costCents, rules)
    const upchargeCents = costCents > 0 ? rules.size_upcharges[group] : 0
    const sellCents = markedUpCents + upchargeCents
    return { group, costCents, markedUpCents, upchargeCents, sellCents, profitCents: sellCents - costCents, marginBp: marginBp(costCents, sellCents) }
  })
}

/** Size-group costs of a catalog garment, keyed by group. */
export function garmentCosts(g: { cost_base_cents: Cents; cost_2xl_cents: Cents; cost_3xl_cents: Cents; cost_4xl_plus_cents: Cents }): Record<SizeGroup, Cents> {
  return { base: g.cost_base_cents, '2xl': g.cost_2xl_cents, '3xl': g.cost_3xl_cents, '4xl_plus': g.cost_4xl_plus_cents }
}
