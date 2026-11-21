/**
 * The quote as the app edits it (a document with nested lines, sizes, imprints and fees), its
 * validation, and the bridge to the pricing engine.
 */
import { z } from 'zod'
import type { Cents } from './money'
import { priceQuote } from './pricing/engine'
import type { AutoFeeKey, ImprintInput, MatrixForPricing, PricingContext, QuoteBreakdown, QuotePricingInput } from './pricing/types'
import { AUTO_FEES, IMPRINT_LOCATIONS, PRINT_SIZES } from './pricing/types'
import type { ActivityEntry, Attachment } from './schemas'
import type { ProductionStatus } from './production'
import { DECORATION_METHODS, GARMENT_CATEGORIES, PricingRulesSchema, SPECIALTY_INKS, SUPPLIERS, hexColor, isoDate, type Customer, type FeePreset, type PricingMatrix, type PricingRulesInput, type Settings } from './schemas'
import { SIZE_GROUPS, type SizeGroup } from './sizes'

export const QUOTE_STATUSES = ['draft', 'sent', 'approved', 'declined', 'expired', 'superseded'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  approved: 'Approved',
  declined: 'Declined',
  expired: 'Expired',
  superseded: 'Revised'
}

const cents = z.number().int().min(0)
const uid = z.string().min(1).max(64)
const groupCents = z.object({ base: cents, '2xl': cents, '3xl': cents, '4xl_plus': cents })

export const ImprintSchema = z.object({
  uid,
  location: z.enum(IMPRINT_LOCATIONS),
  location_custom: z.string().max(60),
  method: z.enum(DECORATION_METHODS),
  colors: z.number().int().min(0, 'Colors can’t be negative').max(20, 'At most 20 colors'),
  underbase: z.boolean(),
  /** 'auto' = suggested because the garment is dark; 'manual' = set by hand */
  underbase_source: z.enum(['auto', 'manual']),
  specialty: z.array(z.enum(SPECIALTY_INKS)),
  print_size: z.enum(PRINT_SIZES),
  stitch_count: z.number().int().min(0).max(200000),
  new_digitizing: z.boolean(),
  transfer_size: z.number().int().min(1),
  is_reorder: z.boolean(),
  matrix_id: z.number().int().positive().nullable(),
  notes: z.string().max(1000),
  /** colors and underbase came from this separation job (shown as a badge; editable) */
  separation_job_id: z.number().int().positive().nullable().optional()
})
export type QuoteImprint = z.infer<typeof ImprintSchema>

export const GarmentSnapshotSchema = z.object({
  brand: z.string().max(100),
  style_number: z.string().max(60),
  name: z.string().max(200),
  category: z.enum(GARMENT_CATEGORIES),
  supplier: z.enum(SUPPLIERS),
  supplier_other: z.string().max(100)
})
export type GarmentSnapshot = z.infer<typeof GarmentSnapshotSchema>

export const QuoteLineSchema = z.object({
  uid,
  garment_id: z.number().int().positive().nullable(),
  garment: GarmentSnapshotSchema,
  /** your cost per size group, copied from the catalog when the garment was picked */
  costs: groupCents,
  /** free text for custom / customer-supplied garments, or extra detail */
  description: z.string().max(500),
  customer_supplied: z.boolean(),
  color_name: z.string().max(80),
  color_hex: hexColor,
  is_dark: z.boolean(),
  sizes: z.array(z.object({ size: z.string().trim().min(1).max(20), qty: z.number().int('Quantities are whole numbers').min(0, 'Quantities can’t be negative').max(1_000_000) })),
  imprints: z.array(ImprintSchema).max(20),
  overrides: z.object({ base: cents.optional(), '2xl': cents.optional(), '3xl': cents.optional(), '4xl_plus': cents.optional() }),
  override_reason: z.string().max(300)
})
export type QuoteLine = z.infer<typeof QuoteLineSchema>

export const QuoteFeeSchema = z.object({
  uid,
  fee_preset_id: z.number().int().positive().nullable(),
  name: z.string().trim().min(1, 'Fee needs a name').max(100),
  kind: z.enum(['screen', 'film', 'digitizing', 'art', 'shipping', 'rush', 'other']),
  basis: z.enum(['per_job', 'per_piece', 'per_hour']),
  quantity: z.number().int().min(0).max(1_000_000).nullable(),
  amount_cents: cents,
  taxable: z.boolean()
})
export type QuoteFee = z.infer<typeof QuoteFeeSchema>

/** Everything the builder edits. Status, number and dates of record are changed by actions, not saves. */
export const QuoteEditSchema = z.object({
  id: z.number().int().positive(),
  customer_id: z.number().int().positive().nullable(),
  contact_id: z.number().int().positive().nullable(),
  job_name: z.string().max(200),
  issued_on: isoDate,
  expires_on: isoDate.nullable(),
  in_hands_on: isoDate.nullable(),
  customer_notes: z.string().max(10000),
  internal_notes: z.string().max(10000),
  tax_bp_override: z.number().int().min(0).max(10000).nullable(),
  discount_mode: z.enum(['percent', 'flat']),
  discount_value: z.number().int().min(0),
  deposit_bp: z.number().int().min(0).max(10000),
  rush: z.boolean(),
  charge_tax_anyway: z.boolean(),
  is_reorder: z.boolean(),
  disabled_auto_fees: z.array(z.enum(AUTO_FEES)),
  lines: z.array(QuoteLineSchema).max(200),
  fees: z.array(QuoteFeeSchema).max(100)
})
export type QuoteEdit = z.infer<typeof QuoteEditSchema>

export interface QuoteRecord extends QuoteEdit {
  number: string
  root_number: string
  revision: number
  previous_revision_id: number | null
  reorder_of_id: number | null
  status: QuoteStatus
  sent_at: string | null
  approved_at: string | null
  approved_by_name: string
  declined_at: string | null
  converted_invoice_id: number | null
  production_status: ProductionStatus | null
  total_cents: Cents
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface QuoteCustomerSummary {
  id: number
  display_name: string
  company_name: string
  first_name: string
  last_name: string
  email: string
  phone: string
  billing: string[]
  shipping: string[]
  tax_exempt: boolean
  exempt_cert_number: string
  exempt_cert_expires_on: string | null
  pricing_matrix_id: number | null
}

export interface QuoteListRow {
  id: number
  number: string
  revision: number
  customer_id: number | null
  customer_name: string
  job_name: string
  status: QuoteStatus
  total_cents: Cents
  issued_on: string
  expires_on: string | null
  in_hands_on: string | null
  archived_at: string | null
  updated_at: string
}

/** Pricing configuration without the customer part; snapshotted on the quote when it leaves draft. */
export interface PricingBase {
  rules: PricingRulesInput
  matrices: MatrixForPricing[]
  rounding_mode: Settings['rounding_mode']
  combine_quantities: boolean
  ink_labor_cost_per_piece_cents: Cents
  default_tax_bp: number
  auto_fee_taxable: Record<AutoFeeKey, boolean>
}

export const PricingBaseSchema = z.object({
  rules: PricingRulesSchema,
  matrices: z.array(z.any()),
  rounding_mode: z.enum(['cent', 'nickel', 'quarter']),
  combine_quantities: z.boolean(),
  ink_labor_cost_per_piece_cents: cents,
  default_tax_bp: z.number().int(),
  auto_fee_taxable: z.record(z.string(), z.boolean())
})

export function buildPricingBase(rules: PricingRulesInput, matrices: PricingMatrix[], settings: Settings, fees: FeePreset[]): PricingBase {
  // Auto fees follow the taxability of the matching fee preset, if there is one.
  const taxable = (kind: FeePreset['kind']) => fees.find((f) => f.kind === kind && !f.archived_at)?.taxable ?? true
  const { markup_mode, markup_tiers, underbase_mode, underbase_adder_cents, specialty_adders, oversize_adders, size_upcharges, min_order_qty, below_min_fee_cents, rush_mode, rush_value, screen_fee_cents, screen_fee_basis, reorder_screen_discount_bp, digitizing_fee_cents } = rules
  return {
    rules: { markup_mode, markup_tiers, underbase_mode, underbase_adder_cents, specialty_adders, oversize_adders, size_upcharges, min_order_qty, below_min_fee_cents, rush_mode, rush_value, screen_fee_cents, screen_fee_basis, reorder_screen_discount_bp, digitizing_fee_cents },
    matrices: matrices.map((m) => ({
      id: m.id,
      name: m.name,
      method: m.method,
      column_kind: m.column_kind,
      breaks: m.breaks,
      columns: m.columns,
      prices: m.prices,
      above_max_rule: m.above_max_rule,
      above_max_adder_cents: m.above_max_adder_cents,
      is_default: m.is_default && !m.archived_at
    })),
    rounding_mode: settings.rounding_mode,
    combine_quantities: settings.combine_quantities,
    ink_labor_cost_per_piece_cents: settings.ink_labor_cost_per_piece_cents,
    default_tax_bp: settings.default_tax_bp,
    auto_fee_taxable: { screens: taxable('screen'), digitizing: taxable('digitizing'), below_min: true, rush: taxable('rush') }
  }
}

export function pricingContext(base: PricingBase, quote: Pick<QuoteEdit, 'tax_bp_override'>, customer: Pick<Customer, 'tax_exempt' | 'exempt_cert_expires_on' | 'pricing_matrix_id'> | null, today: string): PricingContext {
  return {
    rules: base.rules,
    matrices: base.matrices,
    rounding_mode: base.rounding_mode,
    combine_quantities: base.combine_quantities,
    ink_labor_cost_per_piece_cents: base.ink_labor_cost_per_piece_cents,
    tax_bp: quote.tax_bp_override ?? base.default_tax_bp,
    customer: customer ? { tax_exempt: customer.tax_exempt, exempt_cert_expires_on: customer.exempt_cert_expires_on, pricing_matrix_id: customer.pricing_matrix_id } : null,
    auto_fee_taxable: base.auto_fee_taxable,
    today
  }
}

export function toImprintInput(i: QuoteImprint): ImprintInput {
  return {
    uid: i.uid,
    location: i.location,
    location_custom: i.location_custom,
    method: i.method,
    colors: i.colors,
    underbase: i.underbase,
    specialty: i.specialty,
    print_size: i.print_size,
    stitch_count: i.stitch_count,
    new_digitizing: i.new_digitizing,
    transfer_size: i.transfer_size,
    is_reorder: i.is_reorder,
    matrix_id: i.matrix_id
  }
}

/** The part of a quote or invoice the pricing engine reads. */
export type PricedDoc = Pick<QuoteEdit, 'lines' | 'fees' | 'disabled_auto_fees' | 'discount_mode' | 'discount_value' | 'rush' | 'deposit_bp' | 'charge_tax_anyway' | 'tax_bp_override'>

export function toPricingInput(q: PricedDoc, amountPaid = 0): QuotePricingInput {
  return {
    lines: q.lines.map((l) => ({
      uid: l.uid,
      costs: l.costs,
      customer_supplied: l.customer_supplied,
      sizes: l.sizes,
      imprints: l.imprints.map(toImprintInput),
      overrides: Object.fromEntries(SIZE_GROUPS.filter((g) => l.overrides[g] != null).map((g) => [g, l.overrides[g]!])) as Partial<Record<SizeGroup, Cents>>
    })),
    fees: q.fees.map((f) => ({ uid: f.uid, name: f.name, kind: f.kind, basis: f.basis, quantity: f.quantity, amount_cents: f.amount_cents, taxable: f.taxable })),
    disabled_auto_fees: q.disabled_auto_fees,
    discount_mode: q.discount_mode,
    discount_value: q.discount_value,
    rush: q.rush,
    deposit_bp: q.deposit_bp,
    charge_tax_anyway: q.charge_tax_anyway,
    amount_paid_cents: amountPaid
  }
}

export function priceQuoteDoc(q: PricedDoc, base: PricingBase, customer: Pick<QuoteCustomerSummary, 'tax_exempt' | 'exempt_cert_expires_on' | 'pricing_matrix_id'> | null, today: string, amountPaid = 0): QuoteBreakdown {
  return priceQuote(toPricingInput(q, amountPaid), pricingContext(base, q, customer, today))
}

export const newUid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).slice(0, 36)

export function newImprint(over: Partial<QuoteImprint> = {}): QuoteImprint {
  return {
    uid: newUid(),
    location: 'front',
    location_custom: '',
    method: 'screen',
    colors: 1,
    underbase: false,
    underbase_source: 'auto',
    specialty: [],
    print_size: 'standard',
    stitch_count: 5000,
    new_digitizing: false,
    transfer_size: 1,
    is_reorder: false,
    matrix_id: null,
    notes: '',
    ...over
  }
}

export const EMPTY_GARMENT_SNAPSHOT: GarmentSnapshot = { brand: '', style_number: '', name: '', category: 'tee', supplier: 'other', supplier_other: '' }

export function newLine(over: Partial<QuoteLine> = {}): QuoteLine {
  return {
    uid: newUid(),
    garment_id: null,
    garment: { ...EMPTY_GARMENT_SNAPSHOT },
    costs: { base: 0, '2xl': 0, '3xl': 0, '4xl_plus': 0 },
    description: '',
    customer_supplied: false,
    color_name: '',
    color_hex: '#ffffff',
    is_dark: false,
    sizes: [],
    imprints: [],
    overrides: {},
    override_reason: '',
    ...over
  }
}

export function garmentTitle(l: Pick<QuoteLine, 'garment' | 'description'>): string {
  const g = l.garment
  const t = [g.brand, g.style_number].filter(Boolean).join(' ')
  return [t, g.name].filter(Boolean).join(' – ') || l.description || 'Custom item'
}

/** "S:10 M:20 L:15" */
export function sizeBreakdown(sizes: QuoteLine['sizes']): string {
  return sizes
    .filter((s) => s.qty > 0)
    .map((s) => `${s.size}:${s.qty}`)
    .join('  ')
}

/** Displayed status: a sent quote past its expiration reads as expired even before the sweep runs. */
export function effectiveStatus(q: Pick<QuoteRecord, 'status' | 'expires_on'>, today: string): QuoteStatus {
  return q.status === 'sent' && q.expires_on && q.expires_on < today ? 'expired' : q.status
}

export const isEditable = (q: Pick<QuoteRecord, 'status' | 'archived_at'>) => q.status === 'draft' && !q.archived_at

/** What a quote's prices were computed with. Frozen when the quote leaves draft. */
export interface FrozenPricing {
  base: PricingBase
  customer: Pick<QuoteCustomerSummary, 'tax_exempt' | 'exempt_cert_expires_on' | 'pricing_matrix_id'> | null
  priced_on: string
}

export interface QuoteTotals {
  pieces: number
  items_subtotal_cents: number
  fees_subtotal_cents: number
  subtotal_cents: number
  discount_cents: number
  rush_cents: number
  shipping_cents: number
  taxable_cents: number
  tax_bp: number
  tax_cents: number
  total_cents: number
  deposit_cents: number
  cost_cents: number
  profit_cents: number
  margin_bp: number | null
  /** sales before tax and shipping: subtotal − discount + rush (added in Phase 4) */
  net_sales_cents?: number
  /** tax skipped because the customer is exempt (added in Phase 4) */
  tax_exempt?: boolean
}

export interface QuoteDetail {
  quote: QuoteRecord
  customer: QuoteCustomerSummary | null
  /** pricing config to price this quote with: live for drafts, frozen otherwise */
  pricing: FrozenPricing
  breakdown: QuoteBreakdown
  attachments: Attachment[]
  activity: ActivityEntry[]
  /** deposits taken against this quote (they move to the invoice on conversion) */
  payments: import('./invoice').Payment[]
  converted_invoice: { id: number; number: string } | null
  revisions: Array<Pick<QuoteRecord, 'id' | 'number' | 'revision' | 'status' | 'total_cents' | 'updated_at'>>
}

