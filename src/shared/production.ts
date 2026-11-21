/** Production stages for a job (an approved quote, then its invoice). */
export const PRODUCTION_STATUSES = [
  'awaiting_art',
  'proof_sent',
  'proof_approved',
  'garments_ordered',
  'garments_received',
  'in_production',
  'ready',
  'done'
] as const
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number]

export const PRODUCTION_LABELS: Record<ProductionStatus, string> = {
  awaiting_art: 'Awaiting art',
  proof_sent: 'Proof sent',
  proof_approved: 'Proof approved',
  garments_ordered: 'Garments ordered',
  garments_received: 'Garments received',
  in_production: 'In production',
  ready: 'Ready for pickup',
  done: 'Picked up / shipped'
}

/** Stages at which blanks still need ordering. */
export const NEEDS_GARMENTS: ProductionStatus[] = ['awaiting_art', 'proof_sent', 'proof_approved']

export const isProductionStatus = (s: unknown): s is ProductionStatus => typeof s === 'string' && (PRODUCTION_STATUSES as readonly string[]).includes(s)

export interface JobRef {
  kind: 'quote' | 'invoice'
  id: number
}

export interface BoardJob extends JobRef {
  number: string
  customer: string
  job_name: string
  status: ProductionStatus
  in_hands_on: string | null
  pieces: number
  total_cents: number
  /** first mockup marked for the PDF, as an inkwell-file URL */
  thumbnail: string
  updated_at: string | null
}

export interface GarmentOrderItem {
  brand: string
  style_number: string
  name: string
  color: string
  sizes: Record<string, number>
  total: number
  est_cost_cents: number
}

export interface GarmentOrder {
  jobs: Array<JobRef & { number: string; customer: string; job_name: string }>
  size_columns: string[]
  groups: Array<{ supplier: string; items: GarmentOrderItem[]; total: number; est_cost_cents: number }>
  total: number
  est_cost_cents: number
  /** lines left out: customer-supplied garments */
  skipped_customer_supplied: number
}
