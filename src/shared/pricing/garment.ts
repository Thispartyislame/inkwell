import { applyBp, divRound, type Cents } from '../money'
import type { MarkupTier, PricingRulesInput } from '../schemas'

/** The markup tier for a garment cost: the first tier whose limit is at or above the cost. */
export function markupTierFor(costCents: Cents, tiers: MarkupTier[]): MarkupTier {
  if (!tiers.length) throw new Error('No markup tiers configured')
  return tiers.find((t) => t.up_to_cents === null || costCents <= t.up_to_cents) ?? tiers[tiers.length - 1]
}

/**
 * Garment selling price before decoration, rounded half up to the cent.
 * percent mode: value is basis points of markup (10000 = +100%, so ×2).
 * multiplier mode: value is the multiplier × 1000 (1800 = ×1.8).
 */
export function garmentPrice(costCents: Cents, rules: Pick<PricingRulesInput, 'markup_mode' | 'markup_tiers'>): Cents {
  if (costCents <= 0) return 0
  const tier = markupTierFor(costCents, rules.markup_tiers)
  return rules.markup_mode === 'percent' ? costCents + applyBp(costCents, tier.value) : divRound(costCents * tier.value, 1000)
}
