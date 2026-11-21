import type Database from 'better-sqlite3'
import { PAYMENT_METHOD_LABELS, PaymentSchema, statusFromPayments, type InvoiceStatus, type Payment, type PaymentInput } from '@shared/invoice'
import { formatMoney } from '@shared/money'
import { NotFoundError, parseOrThrow, UserError } from '../errors'
import { fromRow, insert, now } from '../rows'
import { logActivity } from './activity'
import { allocateNumber } from './settings'

type DB = Database.Database
const SPEC = { bool: ['is_deposit'] } as const

const SELECT = `SELECT p.*, COALESCE(i.number, q.number, '') AS applied_to
  FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN quotes q ON q.id = p.quote_id`

export function getPayment(db: DB, id: number): Payment {
  const row = db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as Record<string, unknown> | undefined
  if (!row) throw new NotFoundError('Payment', id)
  return fromRow<Payment>(row, SPEC)
}

export function listPayments(db: DB, f: { invoice_id?: number; quote_id?: number; customer_id?: number; includeVoided?: boolean }): Payment[] {
  const where: string[] = []
  const p: Record<string, unknown> = {}
  if (f.invoice_id) {
    where.push('p.invoice_id = @inv')
    p.inv = f.invoice_id
  }
  if (f.quote_id) {
    where.push('p.quote_id = @q AND p.invoice_id IS NULL')
    p.q = f.quote_id
  }
  if (f.customer_id) {
    where.push('p.customer_id = @c')
    p.c = f.customer_id
  }
  if (!f.includeVoided) where.push('p.voided_at IS NULL')
  return (db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.received_on, p.id`).all(p) as Record<string, unknown>[]).map((r) => fromRow<Payment>(r, SPEC))
}

export function paidOn(db: DB, target: { invoice_id?: number; quote_id?: number }): number {
  const row = target.invoice_id
    ? db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM payments WHERE invoice_id = ? AND voided_at IS NULL').get(target.invoice_id)
    : db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM payments WHERE quote_id = ? AND invoice_id IS NULL AND voided_at IS NULL').get(target.quote_id)
  return (row as { s: number }).s
}

/** Recalculate an invoice's paid amount, balance and status from its payments. */
export function recomputeInvoice(db: DB, invoiceId: number): void {
  const inv = db.prepare('SELECT status, total_cents, sent_at, paid_at FROM invoices WHERE id = ?').get(invoiceId) as
    | { status: InvoiceStatus; total_cents: number; sent_at: string | null; paid_at: string | null }
    | undefined
  if (!inv) throw new NotFoundError('Invoice', invoiceId)
  const paid = paidOn(db, { invoice_id: invoiceId })
  const status = inv.status === 'void' ? 'void' : statusFromPayments(inv.total_cents, paid, !!inv.sent_at)
  const paidAt = status === 'paid' ? (inv.paid_at ?? now()) : null
  db.prepare('UPDATE invoices SET paid_cents = ?, balance_cents = ?, status = ?, paid_at = ?, updated_at = ? WHERE id = ?').run(paid, inv.total_cents - paid, status, paidAt, now(), invoiceId)
  if (status !== inv.status) logActivity(db, 'invoice', invoiceId, 'status changed', { from: inv.status, to: status })
}

export function recordPayment(db: DB, input: PaymentInput): Payment {
  const p = parseOrThrow(PaymentSchema, input)
  return db.transaction(() => {
    let customerId: number | null
    if (p.invoice_id) {
      const inv = db.prepare('SELECT number, status, customer_id, archived_at FROM invoices WHERE id = ?').get(p.invoice_id) as
        | { number: string; status: InvoiceStatus; customer_id: number | null; archived_at: string | null }
        | undefined
      if (!inv) throw new NotFoundError('Invoice', p.invoice_id)
      if (inv.status === 'void') throw new UserError(`${inv.number} is void`)
      if (!inv.customer_id) throw new UserError('Pick a customer on the invoice first')
      customerId = inv.customer_id
    } else {
      const q = db.prepare('SELECT number, status, customer_id, converted_invoice_id FROM quotes WHERE id = ?').get(p.quote_id) as
        | { number: string; status: string; customer_id: number | null; converted_invoice_id: number | null }
        | undefined
      if (!q) throw new NotFoundError('Quote', p.quote_id!)
      if (q.converted_invoice_id) throw new UserError(`${q.number} is already invoiced. Record the payment on the invoice.`)
      if (q.status === 'declined' || q.status === 'superseded') throw new UserError(`Can’t take a deposit on a ${q.status === 'superseded' ? 'replaced' : 'declined'} quote`)
      if (!q.customer_id) throw new UserError('Pick a customer on the quote first')
      customerId = q.customer_id
    }
    const { number } = allocateNumber(db, 'receipt')
    const id = insert(db, 'payments', {
      ...p,
      is_deposit: p.is_deposit || !!p.quote_id ? 1 : 0,
      check_number: p.method === 'check' ? p.check_number.trim() : '',
      receipt_number: number,
      customer_id: customerId
    })
    const details = { receipt: number, amount: formatMoney(p.amount_cents), method: PAYMENT_METHOD_LABELS[p.method] }
    if (p.invoice_id) {
      logActivity(db, 'invoice', p.invoice_id, p.is_deposit ? 'deposit recorded' : 'payment recorded', details)
      recomputeInvoice(db, p.invoice_id)
    } else logActivity(db, 'quote', p.quote_id!, 'deposit recorded', details)
    return getPayment(db, id)
  })()
}

export function voidPayment(db: DB, id: number, reason: string): Payment {
  return db.transaction(() => {
    const p = getPayment(db, id)
    if (p.voided_at) return p
    db.prepare('UPDATE payments SET voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?').run(now(), reason.trim().slice(0, 300), now(), id)
    const details = { receipt: p.receipt_number, amount: formatMoney(p.amount_cents), ...(reason.trim() ? { reason: reason.trim() } : {}) }
    if (p.invoice_id) {
      logActivity(db, 'invoice', p.invoice_id, 'payment voided', details)
      recomputeInvoice(db, p.invoice_id)
    } else if (p.quote_id) logActivity(db, 'quote', p.quote_id, 'deposit voided', details)
    return getPayment(db, id)
  })()
}
