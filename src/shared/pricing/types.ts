/** Inputs and outputs of the quote pricing engine. No DB, Electron or UI types here. */
import type { Cents } from '../money'
import type { DecorationMethod, FeePresetInput, PricingMatrixInput, PricingRulesInput, SpecialtyInk } from '../schemas'
import type { SizeGroup } from '../sizes'

export const IMPRINT_LOCATIONS = ['front', 'back', 'left_chest', 'right_chest', 'left_sleeve', 'right_sleeve', 'neck', 'custom'] as const
export type ImprintLocation = (typeof IMPRINT_LOCATIONS)[number]
export const LOCATION_LABELS: Record<ImprintLocation, string> = {
  front: 'Front',
  back: 'Back',
  left_chest: 'Left chest',
  right_chest: 'Right chest',
  left_sleeve: 'Left sleeve',
  right_sleeve: 'Right sleeve',
  neck: 'Neck / tag',
  custom: 'Custom'
}
export const PRINT_SIZES = ['standard', 'oversized', 'jumbo'] as const
export type PrintSize = (typeof PRINT_SIZES)[number]

export interface ImprintInput {
  uid: string
  location: ImprintLocation
  location_custom: string
  method: DecorationMethod
  /** ink colors (screen print); ignored by other methods */
  colors: number
  underbase: boolean
  specialty: SpecialtyInk[]
  print_size: PrintSize
  stitch_count: number
  new_digitizing: boolean
  /** column value of a size-kind matrix (DTF / transfers) */
  transfer_size: number
  is_reorder: boolean
  matrix_id: number | null
}

export interface LineInput {
  uid: string
  /** your cost per size group (from the garment snapshot; 0 when unknown) */
  costs: Record<SizeGroup, Cents>
  customer_supplied: boolean
  sizes: { size: string; qty: number }[]
  imprints: ImprintInput[]
  /** manual unit price per size group, replaces the calculated one */
  overrides: Partial<Record<SizeGroup, Cents>>
}

export interface FeeInput {
  uid: string
  name: string
  kind: FeePresetInput['kind']
  basis: FeePresetInput['basis']
  /** hours / pieces / count. null = default (1, or total pieces for per-piece fees) */
  quantity: number | null
  amount_cents: Cents
  taxable: boolean
}

export const AUTO_FEES = ['screens', 'digitizing', 'below_min', 'rush'] as const
export type AutoFeeKey = (typeof AUTO_FEES)[number]

export interface QuotePricingInput {
  lines: LineInput[]
  fees: FeeInput[]
  disabled_auto_fees: AutoFeeKey[]
  discount_mode: 'percent' | 'flat'
  /** bp for percent, cents for flat */
  discount_value: number
  rush: boolean
  deposit_bp: number
  /** charge tax even though the customer is marked exempt (expired certificate) */
  charge_tax_anyway: boolean
  amount_paid_cents: Cents
}

export type MatrixForPricing = Omit<PricingMatrixInput, 'id' | 'notes'> & { id: number }

export interface PricingContext {
  rules: PricingRulesInput
  matrices: MatrixForPricing[]
  rounding_mode: 'cent' | 'nickel' | 'quarter'
  combine_quantities: boolean
  ink_labor_cost_per_piece_cents: Cents
  tax_bp: number
  customer: { tax_exempt: boolean; exempt_cert_expires_on: string | null; pricing_matrix_id: number | null } | null
  /** whether the automatic fees are taxable (taken from the matching fee presets) */
  auto_fee_taxable: Record<AutoFeeKey, boolean>
  /** YYYY-MM-DD, for certificate expiry */
  today: string
}

export type WarningCode =
  | 'no_matrix'
  | 'below_matrix_min'
  | 'above_matrix_max'
  | 'below_min_order'
  | 'exempt_cert_expired'
  | 'exempt_no_cert_date'
  | 'no_quantity'
  | 'no_imprints'
  | 'no_garment_cost'
  | 'unit_override'

export interface PricingWarning {
  code: WarningCode
  message: string
  line_uid?: string
  imprint_uid?: string
  /** blocking warnings should be resolved before sending */
  severity: 'info' | 'warn'
}

export interface ImprintBreakdown {
  uid: string
  matrix_id: number | null
  matrix_name: string
  break_qty: number
  /** quantity used to pick the break (combined across lines when enabled) */
  priced_qty: number
  column_label: string
  matrix_cents: Cents
  adders: { label: string; cents: Cents }[]
  per_piece_cents: Cents
}

export interface GroupBreakdown {
  group: SizeGroup
  qty: number
  cost_cents: Cents
  garment_cents: Cents
  decoration_cents: Cents
  upcharge_cents: Cents
  calculated_unit_cents: Cents
  unit_cents: Cents
  overridden: boolean
  total_cents: Cents
}

export interface LineBreakdown {
  uid: string
  qty: number
  design_key: string
  priced_qty: number
  groups: GroupBreakdown[]
  imprints: ImprintBreakdown[]
  decoration_per_piece_cents: Cents
  total_cents: Cents
  cost_cents: Cents
}

export interface FeeLine {
  key: string
  name: string
  auto: boolean
  kind: FeeInput['kind']
  quantity: number
  unit_cents: Cents
  amount_cents: Cents
  taxable: boolean
  detail?: string
}

export interface QuoteBreakdown {
  lines: LineBreakdown[]
  fees: FeeLine[]
  total_pieces: number
  items_subtotal_cents: Cents
  fees_subtotal_cents: Cents
  subtotal_cents: Cents
  discount_cents: Cents
  rush_cents: Cents
  shipping_cents: Cents
  taxable_cents: Cents
  tax_bp: number
  tax_cents: Cents
  tax_exempt_applied: boolean
  total_cents: Cents
  deposit_cents: Cents
  paid_cents: Cents
  balance_cents: Cents
  screens: number
  cost_cents: Cents
  profit_cents: Cents
  margin_bp: number | null
  warnings: PricingWarning[]
}
