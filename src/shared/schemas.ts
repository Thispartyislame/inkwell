/**
 * Validation schemas shared by forms (renderer) and IPC handlers (main). Main re-validates
 * everything it receives, so a bad value can never reach the database.
 * Field names match database columns (snake_case) to keep mapping trivial.
 */
import { z } from 'zod'

// ---------- primitives ----------
export const cents = z.number().int('Must be whole cents').min(0, 'Can’t be negative')
export const bp = z.number().int().min(0, 'Can’t be negative')
export const qty = z.number().int('Must be a whole number').min(0, 'Can’t be negative')
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
export const optionalEmail = z.union([z.literal(''), z.email('Enter a valid email address')])
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #1a2b3c')
const text = (max = 500) => z.string().max(max)
const id = z.number().int().positive()

// ---------- settings ----------
export const PAYMENT_TERMS = ['due_on_receipt', 'net_7', 'net_15', 'net_30', 'net_45', 'net_60', 'custom'] as const
export const PAYMENT_TERMS_LABELS: Record<(typeof PAYMENT_TERMS)[number], string> = {
  due_on_receipt: 'Due on receipt',
  net_7: 'Net 7',
  net_15: 'Net 15',
  net_30: 'Net 30',
  net_45: 'Net 45',
  net_60: 'Net 60',
  custom: 'Custom (days below)'
}

export const SettingsSchema = z.object({
  shop_name: text(120),
  logo_path: z.string().nullable(),
  address_line1: text(200),
  address_line2: text(200),
  city: text(100),
  state: text(100),
  postal_code: text(20),
  country: text(60),
  phone: text(40),
  email: optionalEmail,
  website: text(200),
  tax_id: text(60),
  default_tax_bp: bp.max(10000, 'Tax rate can’t exceed 100%'),
  default_deposit_bp: bp.max(10000, 'Deposit can’t exceed 100%'),
  quote_expiration_days: qty.max(3650),
  payment_terms: z.enum(PAYMENT_TERMS),
  payment_terms_days: qty.max(3650),
  quote_prefix: text(12),
  quote_next_number: z.number().int().min(1),
  invoice_prefix: text(12),
  invoice_next_number: z.number().int().min(1),
  receipt_prefix: text(12),
  receipt_next_number: z.number().int().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code'),
  accent_color: hexColor,
  theme: z.enum(['system', 'light', 'dark']),
  pdf_footer_text: text(1000),
  terms_text: text(10000),
  how_to_pay_text: text(2000),
  rounding_mode: z.enum(['cent', 'nickel', 'quarter']),
  combine_quantities: z.boolean(),
  ink_labor_cost_per_piece_cents: cents,
  smtp_host: text(200),
  smtp_port: z.number().int().min(1).max(65535),
  smtp_secure: z.boolean(),
  smtp_user: text(200),
  smtp_from_name: text(120),
  email_quote_subject: text(300),
  email_quote_body: text(5000),
  email_invoice_subject: text(300),
  email_invoice_body: text(5000),
  email_receipt_subject: text(300),
  email_receipt_body: text(5000)
})
export type SettingsInput = z.infer<typeof SettingsSchema>
export interface Settings extends SettingsInput {
  /** last number actually issued; next_number can't be set at or below these */
  quote_last_issued: number
  invoice_last_issued: number
  receipt_last_issued: number
  smtp_password_set: boolean
  setup_completed_at: string | null
  last_backup_at: string | null
  updated_at: string
}

// ---------- customers ----------
export const CustomerSchema = z
  .object({
    id: id.optional(),
    company_name: text(200),
    first_name: text(100),
    last_name: text(100),
    email: optionalEmail,
    phone: text(40),
    billing_line1: text(200),
    billing_line2: text(200),
    billing_city: text(100),
    billing_state: text(100),
    billing_postal_code: text(20),
    shipping_same_as_billing: z.boolean(),
    shipping_line1: text(200),
    shipping_line2: text(200),
    shipping_city: text(100),
    shipping_state: text(100),
    shipping_postal_code: text(20),
    tax_exempt: z.boolean(),
    exempt_cert_number: text(100),
    exempt_cert_attachment_id: id.nullable(),
    exempt_cert_expires_on: isoDate.nullable(),
    pricing_matrix_id: id.nullable(),
    notes: text(10000),
    tags: z.array(z.string().trim().min(1).max(40)).max(30)
  })
  .refine((c) => c.company_name.trim() || c.first_name.trim() || c.last_name.trim(), {
    message: 'Enter a company or a contact name',
    path: ['company_name']
  })
export type CustomerInput = z.infer<typeof CustomerSchema>
export interface Customer extends Omit<CustomerInput, 'id'> {
  id: number
  created_at: string
  updated_at: string
  archived_at: string | null
}

export const ContactSchema = z.object({
  id: id.optional(),
  customer_id: id,
  name: z.string().trim().min(1, 'Name is required').max(200),
  email: optionalEmail,
  phone: text(40),
  role: text(100)
})
export type ContactInput = z.infer<typeof ContactSchema>
export interface Contact extends Omit<ContactInput, 'id'> {
  id: number
  sort_order: number
}

/** List row with computed fields (balances fill in once invoices exist in Phase 3). */
export interface CustomerListRow extends Customer {
  display_name: string
  quote_count: number
  invoice_count: number
  balance_cents: number
}

export function customerDisplayName(c: Pick<Customer, 'company_name' | 'first_name' | 'last_name'>): string {
  const person = [c.first_name, c.last_name].filter((s) => s.trim()).join(' ')
  return c.company_name.trim() || person || 'Unnamed customer'
}

// ---------- garments ----------
export const GARMENT_CATEGORIES = ['tee', 'long_sleeve', 'hoodie', 'crewneck', 'hat', 'tote', 'polo', 'jacket', 'other'] as const
export const GARMENT_CATEGORY_LABELS: Record<(typeof GARMENT_CATEGORIES)[number], string> = {
  tee: 'Tee',
  long_sleeve: 'Long sleeve',
  hoodie: 'Hoodie',
  crewneck: 'Crewneck',
  hat: 'Hat',
  tote: 'Tote',
  polo: 'Polo',
  jacket: 'Jacket',
  other: 'Other'
}
export const SUPPLIERS = ['ss_activewear', 'sanmar', 'alphabroder', 'local', 'other'] as const
export const SUPPLIER_LABELS: Record<(typeof SUPPLIERS)[number], string> = {
  ss_activewear: 'S&S Activewear',
  sanmar: 'SanMar',
  alphabroder: 'alphabroder',
  local: 'Local',
  other: 'Other'
}

export const GarmentColorSchema = z.object({
  name: z.string().trim().min(1).max(80),
  hex: hexColor,
  is_dark: z.boolean()
})
export type GarmentColor = z.infer<typeof GarmentColorSchema>

export const GarmentSchema = z.object({
  id: id.optional(),
  brand: text(100),
  style_number: text(60),
  name: z.string().trim().min(1, 'Name is required').max(200),
  category: z.enum(GARMENT_CATEGORIES),
  supplier: z.enum(SUPPLIERS),
  supplier_other: text(100),
  colors: z.array(GarmentColorSchema).max(500),
  sizes: z.array(z.string().trim().min(1).max(20)).max(60),
  cost_base_cents: cents,
  cost_2xl_cents: cents,
  cost_3xl_cents: cents,
  cost_4xl_plus_cents: cents,
  notes: text(5000),
  active: z.boolean()
})
export type GarmentInput = z.infer<typeof GarmentSchema>
export interface Garment extends Omit<GarmentInput, 'id'> {
  id: number
  created_at: string
  updated_at: string
  archived_at: string | null
}

// ---------- pricing ----------
export const DECORATION_METHODS = ['screen', 'embroidery', 'dtf', 'transfer', 'other'] as const
export type DecorationMethod = (typeof DECORATION_METHODS)[number]
export const METHOD_LABELS: Record<DecorationMethod, string> = {
  screen: 'Screen print',
  embroidery: 'Embroidery',
  dtf: 'DTF',
  transfer: 'Heat transfer / vinyl',
  other: 'Other'
}
export const COLUMN_KIND_LABELS = { colors: 'Ink colors', stitches: 'Stitch count (up to)', size: 'Print size' } as const

export const MatrixColumnSchema = z.object({
  /** colors: number of colors; stitches: upper bound of the band; size: band order */
  value: z.number().int().min(1),
  label: z.string().max(40)
})
export type MatrixColumn = z.infer<typeof MatrixColumnSchema>

export const PricingMatrixSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(1, 'Name is required').max(100),
    method: z.enum(DECORATION_METHODS),
    column_kind: z.enum(['colors', 'stitches', 'size']),
    breaks: z.array(z.number().int().min(1, 'Quantity breaks start at 1')).min(1, 'Add at least one quantity break'),
    columns: z.array(MatrixColumnSchema).min(1, 'Add at least one column'),
    prices: z.array(z.array(cents)),
    above_max_rule: z.enum(['use_last', 'per_extra_color', 'not_allowed']),
    above_max_adder_cents: cents,
    is_default: z.boolean(),
    notes: text(2000)
  })
  .superRefine((m, ctx) => {
    for (let i = 1; i < m.breaks.length; i++) {
      if (m.breaks[i] <= m.breaks[i - 1])
        ctx.addIssue({ code: 'custom', message: 'Quantity breaks must increase from top to bottom', path: ['breaks', i] })
    }
    for (let i = 1; i < m.columns.length; i++) {
      if (m.columns[i].value <= m.columns[i - 1].value)
        ctx.addIssue({ code: 'custom', message: 'Columns must increase from left to right', path: ['columns', i] })
    }
    if (m.prices.length !== m.breaks.length || m.prices.some((r) => r.length !== m.columns.length))
      ctx.addIssue({ code: 'custom', message: 'Price grid doesn’t match breaks × columns', path: ['prices'] })
  })
export type PricingMatrixInput = z.infer<typeof PricingMatrixSchema>
export interface PricingMatrix extends Omit<PricingMatrixInput, 'id'> {
  id: number
  is_sample: boolean
  created_at: string
  updated_at: string
  archived_at: string | null
}

export const SPECIALTY_INKS = ['puff', 'glow', 'metallic', 'discharge', 'water_based', 'high_density'] as const
export type SpecialtyInk = (typeof SPECIALTY_INKS)[number]
export const SPECIALTY_LABELS: Record<SpecialtyInk, string> = {
  puff: 'Puff',
  glow: 'Glow',
  metallic: 'Metallic',
  discharge: 'Discharge',
  water_based: 'Water-based',
  high_density: 'High density'
}

export const MARKUP_MODES = ['percent', 'multiplier', 'margin'] as const
export type MarkupMode = (typeof MARKUP_MODES)[number]

export const MarkupTierSchema = z.object({
  /** applies to garments costing up to this many cents; null = no upper limit */
  up_to_cents: cents.nullable(),
  /**
   * percent mode: basis points of markup over cost (10000 = +100%)
   * multiplier mode: multiplier × 1000 (1800 = ×1.8)
   * margin mode: basis points of target gross margin on the sell price (4000 = 40%)
   */
  value: z.number().int().min(0)
})
export type MarkupTier = z.infer<typeof MarkupTierSchema>

export const PricingRulesSchema = z
  .object({
    markup_mode: z.enum(MARKUP_MODES),
    markup_tiers: z.array(MarkupTierSchema).min(1, 'Add at least one markup tier'),
    underbase_mode: z.enum(['plus_one_color', 'flat_adder']),
    underbase_adder_cents: cents,
    specialty_adders: z.record(z.enum(SPECIALTY_INKS), cents),
    oversize_adders: z.object({ oversized: cents, jumbo: cents }),
    size_upcharges: z.object({ base: cents, '2xl': cents, '3xl': cents, '4xl_plus': cents }),
    min_order_qty: qty,
    below_min_fee_cents: cents,
    rush_mode: z.enum(['percent', 'flat']),
    rush_value: z.number().int().min(0),
    screen_fee_cents: cents,
    screen_fee_basis: z.enum(['per_screen', 'per_color']),
    reorder_screen_discount_bp: bp.max(10000),
    digitizing_fee_cents: cents
  })
  .superRefine((r, ctx) => {
    const t = r.markup_tiers
    t.forEach((tier, i) => {
      const last = i === t.length - 1
      if (last && tier.up_to_cents !== null)
        ctx.addIssue({ code: 'custom', message: 'The last tier must have no upper limit', path: ['markup_tiers', i] })
      if (!last && tier.up_to_cents === null)
        ctx.addIssue({ code: 'custom', message: 'Only the last tier can have no upper limit', path: ['markup_tiers', i] })
      if (i > 0 && tier.up_to_cents !== null && t[i - 1].up_to_cents !== null && tier.up_to_cents <= t[i - 1].up_to_cents!)
        ctx.addIssue({ code: 'custom', message: 'Tier limits must increase', path: ['markup_tiers', i] })
      if (r.markup_mode === 'margin' && tier.value >= 9500)
        ctx.addIssue({ code: 'custom', message: 'Margin must be below 95%', path: ['markup_tiers', i] })
    })
  })
export type PricingRulesInput = z.infer<typeof PricingRulesSchema>
export interface PricingRules extends PricingRulesInput {
  is_sample: boolean
  updated_at: string
}

export const FeePresetSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, 'Name is required').max(100),
  kind: z.enum(['screen', 'film', 'digitizing', 'art', 'shipping', 'rush', 'other']),
  basis: z.enum(['per_job', 'per_piece', 'per_hour']),
  amount_cents: cents,
  taxable: z.boolean(),
  sort_order: z.number().int()
})
export type FeePresetInput = z.infer<typeof FeePresetSchema>
export interface FeePreset extends Omit<FeePresetInput, 'id'> {
  id: number
  is_sample: boolean
  archived_at: string | null
}
export const FEE_BASIS_LABELS = { per_job: 'Per job', per_piece: 'Per piece', per_hour: 'Per hour' } as const

export const INK_TYPES = ['plastisol', 'water_based', 'discharge', 'specialty'] as const
export const INK_TYPE_LABELS: Record<(typeof INK_TYPES)[number], string> = {
  plastisol: 'Plastisol',
  water_based: 'Water-based',
  discharge: 'Discharge',
  specialty: 'Specialty'
}
export const InkSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, 'Name is required').max(100),
  pms: text(40),
  hex: hexColor,
  type: z.enum(INK_TYPES),
  notes: text(2000)
})
export type InkInput = z.infer<typeof InkSchema>
export interface Ink extends Omit<InkInput, 'id'> {
  id: number
  archived_at: string | null
}

// ---------- attachments ----------
export const ATTACHMENT_KINDS = ['mockup', 'artwork', 'proof', 'tax_cert', 'film', 'logo', 'other'] as const
export interface Attachment {
  id: number
  owner_type: 'quote' | 'invoice' | 'customer' | 'separation' | 'settings'
  owner_id: number
  rel_path: string
  original_name: string
  mime: string
  size_bytes: number
  kind: (typeof ATTACHMENT_KINDS)[number]
  caption: string
  include_in_pdf: boolean
  sort_order: number
  created_at: string
}

export interface ActivityEntry {
  id: number
  entity_type: string
  entity_id: number
  action: string
  details: Record<string, unknown>
  created_at: string
}

/** Turn a zod error into { field: message } for forms. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}
