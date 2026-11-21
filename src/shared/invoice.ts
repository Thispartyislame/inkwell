/** Invoices and payments: shapes, validation and status rules shared by main and the UI. */
import { z } from 'zod'
import { addDays } from './dates'
import type { Cents } from './money'
import type { QuoteBreakdown } from './pricing/types'
import { QuoteEditSchema, type FrozenPricing, type QuoteCustomerSummary } from './quote'
import { isoDate, PAYMENT_TERMS_LABELS, type ActivityEntry, type Attachment, type Settings } from './schemas'

export const INVOICE_STATUSES = ['draft', 'sent', 'partially_paid', 'paid', 'void'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]
/** What the UI shows: the stored status, or "overdue" when an unpaid invoice is past due. */
export type InvoiceDisplayStatus = InvoiceStatus | 'overdue'
export const INVOICE_STATUS_LABELS: Record<InvoiceDisplayStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  void: 'Void',
  overdue: 'Overdue'
}

export const InvoiceEditSchema = QuoteEditSchema.omit({ expires_on: true }).extend({
  due_on: isoDate.nullable(),
  payment_terms: z.string().max(100),
  po_number: z.string().max(60)
})
export type InvoiceEdit = z.infer<typeof InvoiceEditSchema>

export interface InvoiceRecord extends InvoiceEdit {
  number: string
  source_quote_id: number | null
  status: InvoiceStatus
  pricing_locked: boolean
  total_cents: Cents
  paid_cents: Cents
  balance_cents: Cents
  sent_at: string | null
  paid_at: string | null
  voided_at: string | null
  void_reason: string
  created_at: string
  updated_at: string
  archived_at: string | null
}

export const PAYMENT_METHODS = ['cash', 'check', 'card', 'venmo', 'paypal', 'zelle', 'bank_transfer', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  check: 'Check',
  card: 'Card',
  venmo: 'Venmo',
  paypal: 'PayPal',
  zelle: 'Zelle',
  bank_transfer: 'Bank transfer',
  other: 'Other'
}

export const PaymentSchema = z
  .object({
    invoice_id: z.number().int().positive().nullable(),
    quote_id: z.number().int().positive().nullable(),
    received_on: isoDate,
    amount_cents: z.number().int('Whole cents only').positive('Enter an amount above $0'),
    method: z.enum(PAYMENT_METHODS),
    check_number: z.string().max(40),
    reference: z.string().max(200),
    note: z.string().max(1000),
    is_deposit: z.boolean()
  })
  .refine((p) => (p.invoice_id == null) !== (p.quote_id == null), { message: 'A payment is for an invoice or a quote', path: ['invoice_id'] })
export type PaymentInput = z.infer<typeof PaymentSchema>

export interface Payment extends PaymentInput {
  id: number
  receipt_number: string
  customer_id: number | null
  voided_at: string | null
  void_reason: string
  created_at: string
  /** number of the invoice or quote it was paid against */
  applied_to: string
}

export interface InvoiceDetail {
  invoice: InvoiceRecord
  customer: QuoteCustomerSummary | null
  pricing: FrozenPricing
  breakdown: QuoteBreakdown
  payments: Payment[]
  attachments: Attachment[]
  activity: ActivityEntry[]
  source_quote: { id: number; number: string } | null
}

export interface InvoiceListRow {
  id: number
  number: string
  customer_id: number | null
  customer_name: string
  job_name: string
  status: InvoiceStatus
  total_cents: Cents
  paid_cents: Cents
  balance_cents: Cents
  issued_on: string
  due_on: string | null
  archived_at: string | null
}

export function invoiceDisplayStatus(i: Pick<InvoiceRecord, 'status' | 'due_on' | 'balance_cents'>, today: string): InvoiceDisplayStatus {
  if ((i.status === 'sent' || i.status === 'partially_paid') && i.due_on && i.due_on < today && i.balance_cents > 0) return 'overdue'
  return i.status
}

/** Status from money received, for any invoice that isn't void. */
export function statusFromPayments(total: Cents, paid: Cents, wasSent: boolean): InvoiceStatus {
  if (paid > 0 && paid >= total) return 'paid'
  if (paid > 0) return 'partially_paid'
  return wasSent ? 'sent' : 'draft'
}

const TERM_DAYS: Record<string, number> = { due_on_receipt: 0, net_7: 7, net_15: 15, net_30: 30, net_45: 45, net_60: 60 }

export function paymentTermsFromSettings(s: Pick<Settings, 'payment_terms' | 'payment_terms_days'>): { label: string; days: number } {
  if (s.payment_terms === 'custom') return { label: s.payment_terms_days ? `Net ${s.payment_terms_days}` : 'Due on receipt', days: s.payment_terms_days }
  return { label: PAYMENT_TERMS_LABELS[s.payment_terms], days: TERM_DAYS[s.payment_terms] ?? 0 }
}

export function dueDate(issuedOn: string, days: number): string {
  return addDays(issuedOn, days)
}

/** Editable until it's sent (or voided). Payments alone don't lock it: final counts often change after a deposit. */
export const isInvoiceEditable = (i: Pick<InvoiceRecord, 'status' | 'archived_at' | 'sent_at'>) => i.status !== 'void' && !i.sent_at && !i.archived_at
