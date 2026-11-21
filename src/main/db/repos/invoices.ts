import type Database from 'better-sqlite3'
import type { InvoiceFilter } from '@shared/ipc'
import {
  dueDate,
  InvoiceEditSchema,
  isInvoiceEditable,
  paymentTermsFromSettings,
  type InvoiceDetail,
  type InvoiceEdit,
  type InvoiceListRow,
  type InvoiceRecord,
  type InvoiceStatus
} from '@shared/invoice'
import type { QuoteBreakdown } from '@shared/pricing/types'
import { priceQuoteDoc, type FrozenPricing } from '@shared/quote'
import { customerDisplayName } from '@shared/schemas'
import { NotFoundError, parseOrThrow, UserError } from '../errors'
import { fromRow, insert, likePattern, now, toRow, update } from '../rows'
import { listActivity, logActivity } from './activity'
import { listAttachments } from './attachments'
import { checkCustomer, customerSummary, livePricingBase, loadChildren, referencedMatrices, totalsOf, writeChildren } from './docstore'
import { listPayments, paidOn, recomputeInvoice } from './payments'
import { effectivePricing as quotePricing, loadQuote } from './quotes'
import { allocateNumber, getSettings } from './settings'

type DB = Database.Database
const SPEC = { bool: ['rush', 'charge_tax_anyway', 'is_reorder', 'pricing_locked'], json: ['disabled_auto_fees'] } as const
const EDIT_FIELDS = (Object.keys(InvoiceEditSchema.shape) as (keyof InvoiceEdit)[]).filter((k) => k !== 'id' && k !== 'lines' && k !== 'fees')

// ---------- reading ----------
export function loadInvoice(db: DB, id: number): InvoiceRecord {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) throw new NotFoundError('Invoice', id)
  const { pricing_base: _p, totals: _t, ...rest } = row
  return { ...fromRow<Omit<InvoiceRecord, 'lines' | 'fees'>>(rest, SPEC), ...loadChildren(db, 'invoice', id) }
}

function storedPricing(db: DB, id: number): FrozenPricing | null {
  const raw = (db.prepare('SELECT pricing_base FROM invoices WHERE id = ?').get(id) as { pricing_base: string | null }).pricing_base
  return raw ? (JSON.parse(raw) as FrozenPricing) : null
}

/** Unsent invoices from scratch follow current pricing; converted or sent invoices keep what they were priced with. */
export function invoicePricing(db: DB, inv: InvoiceRecord, today: string): FrozenPricing {
  if (!isInvoiceEditable(inv) || inv.pricing_locked) {
    const f = storedPricing(db, inv.id)
    if (f) return f
  }
  const c = customerSummary(db, inv.customer_id)
  return { base: livePricingBase(db, referencedMatrices(inv.lines)), customer: c && { tax_exempt: c.tax_exempt, exempt_cert_expires_on: c.exempt_cert_expires_on, pricing_matrix_id: c.pricing_matrix_id }, priced_on: today }
}

function priceInvoice(inv: InvoiceEdit, p: FrozenPricing, paid: number): QuoteBreakdown {
  return priceQuoteDoc(inv, p.base, p.customer, p.priced_on, paid)
}

export function getInvoiceDetail(db: DB, id: number, today: string): InvoiceDetail {
  const invoice = loadInvoice(db, id)
  const pricing = invoicePricing(db, invoice, today)
  const src = invoice.source_quote_id ? (db.prepare('SELECT id, number FROM quotes WHERE id = ?').get(invoice.source_quote_id) as { id: number; number: string } | undefined) : undefined
  return {
    invoice,
    customer: customerSummary(db, invoice.customer_id),
    pricing,
    breakdown: priceInvoice(invoice, pricing, invoice.paid_cents),
    payments: listPayments(db, { invoice_id: id, includeVoided: true }),
    attachments: listAttachments(db, 'invoice', id),
    activity: listActivity(db, 'invoice', id),
    source_quote: src ?? null
  }
}

export function listInvoices(db: DB, f: InvoiceFilter = {}): InvoiceListRow[] {
  const where: string[] = []
  const p: Record<string, unknown> = {}
  if (!f.includeArchived) where.push('i.archived_at IS NULL')
  if (f.status === 'overdue') {
    where.push(`i.status IN ('sent', 'partially_paid') AND i.balance_cents > 0 AND i.due_on < @today`)
    p.today = f.today ?? new Date().toISOString().slice(0, 10)
  } else if (f.status === 'unpaid') where.push(`i.status IN ('sent', 'partially_paid') AND i.balance_cents > 0`)
  else if (f.status) {
    where.push('i.status = @status')
    p.status = f.status
  }
  if (f.customer_id) {
    where.push('i.customer_id = @cid')
    p.cid = f.customer_id
  }
  if (f.from) {
    where.push('i.issued_on >= @from')
    p.from = f.from
  }
  if (f.to) {
    where.push('i.issued_on <= @to')
    p.to = f.to
  }
  if (f.search?.trim()) {
    p.q = likePattern(f.search.trim())
    where.push(`(i.number LIKE @q ESCAPE '\\' OR i.job_name LIKE @q ESCAPE '\\' OR i.po_number LIKE @q ESCAPE '\\' OR c.company_name LIKE @q ESCAPE '\\' OR (c.first_name || ' ' || c.last_name) LIKE @q ESCAPE '\\')`)
  }
  const rows = db
    .prepare(
      `SELECT i.id, i.number, i.customer_id, i.job_name, i.status, i.total_cents, i.paid_cents, i.balance_cents, i.issued_on, i.due_on, i.archived_at,
         c.company_name, c.first_name, c.last_name
       FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY i.issued_on DESC, i.id DESC`
    )
    .all(p) as Array<InvoiceListRow & { company_name: string | null; first_name: string | null; last_name: string | null }>
  return rows.map(({ company_name, first_name, last_name, ...r }) => ({
    ...r,
    customer_name: r.customer_id ? customerDisplayName({ company_name: company_name ?? '', first_name: first_name ?? '', last_name: last_name ?? '' }) : ''
  }))
}

// ---------- writing ----------
function writeInvoice(db: DB, inv: InvoiceEdit, pricing: FrozenPricing): QuoteBreakdown {
  const paid = paidOn(db, { invoice_id: inv.id })
  const b = priceInvoice(inv, pricing, paid)
  const fields = Object.fromEntries(EDIT_FIELDS.map((k) => [k, inv[k]]))
  update(db, 'invoices', inv.id, {
    ...toRow(fields, SPEC),
    pricing_base: JSON.stringify(pricing),
    totals: JSON.stringify(totalsOf(b)),
    total_cents: b.total_cents
  })
  writeChildren(db, 'invoice', inv.id, inv.lines, inv.fees, b)
  recomputeInvoice(db, inv.id)
  return b
}

function terms(db: DB, today: string) {
  const t = paymentTermsFromSettings(getSettings(db))
  return { payment_terms: t.label, due_on: dueDate(today, t.days) }
}

/** A blank invoice, not from a quote. */
export function createInvoice(db: DB, opts: { customer_id?: number | null }, today: string): InvoiceRecord {
  return db.transaction(() => {
    checkCustomer(db, opts.customer_id ?? null, null)
    const { number } = allocateNumber(db, 'invoice')
    const id = insert(db, 'invoices', { number, status: 'draft', customer_id: opts.customer_id ?? null, issued_on: today, ...terms(db, today) })
    const inv = loadInvoice(db, id)
    writeInvoice(db, inv, invoicePricing(db, inv, today))
    logActivity(db, 'invoice', id, 'created')
    return loadInvoice(db, id)
  })()
}

/**
 * Convert an approved quote into an invoice: copies its lines and fees and the exact pricing the
 * quote was approved at, links both ways, and moves any deposits over as payments.
 */
export function convertQuote(db: DB, quoteId: number, today: string): InvoiceRecord {
  return db.transaction(() => {
    const q = loadQuote(db, quoteId)
    if (q.archived_at) throw new UserError('Restore the quote first')
    if (q.converted_invoice_id) {
      const existing = db.prepare('SELECT number FROM invoices WHERE id = ?').get(q.converted_invoice_id) as { number: string } | undefined
      throw new UserError(`${q.number} was already converted to ${existing?.number ?? 'an invoice'}`)
    }
    if (q.status !== 'approved') throw new UserError(`Only approved quotes can be invoiced (${q.number} is ${q.status}). Approve it first.`)
    if (!q.customer_id) throw new UserError('The quote has no customer')
    const { number } = allocateNumber(db, 'invoice')
    const id = insert(db, 'invoices', {
      number,
      source_quote_id: q.id,
      customer_id: q.customer_id,
      contact_id: q.contact_id,
      status: 'draft',
      issued_on: today,
      pricing_locked: 1,
      ...terms(db, today)
    })
    const edit: InvoiceEdit = {
      id,
      customer_id: q.customer_id,
      contact_id: q.contact_id,
      job_name: q.job_name,
      po_number: '',
      issued_on: today,
      in_hands_on: q.in_hands_on,
      customer_notes: q.customer_notes,
      internal_notes: q.internal_notes,
      tax_bp_override: q.tax_bp_override,
      discount_mode: q.discount_mode,
      discount_value: q.discount_value,
      deposit_bp: q.deposit_bp,
      rush: q.rush,
      charge_tax_anyway: q.charge_tax_anyway,
      is_reorder: q.is_reorder,
      disabled_auto_fees: q.disabled_auto_fees,
      lines: q.lines,
      fees: q.fees,
      ...terms(db, today)
    }
    // Deposits taken on the quote become payments on the invoice.
    const moved = db.prepare('UPDATE payments SET invoice_id = ?, updated_at = ? WHERE quote_id = ? AND invoice_id IS NULL').run(id, now(), q.id).changes
    writeInvoice(db, edit, quotePricing(db, q, today))
    db.prepare('UPDATE quotes SET converted_invoice_id = ?, updated_at = ? WHERE id = ?').run(id, now(), q.id)
    logActivity(db, 'quote', q.id, 'converted', { invoice: number })
    logActivity(db, 'invoice', id, 'created', { from_quote: q.number, ...(moved ? { deposits_carried_over: moved } : {}) })
    return loadInvoice(db, id)
  })()
}

export function saveInvoice(db: DB, input: InvoiceEdit, today: string): InvoiceDetail {
  const e = parseOrThrow(InvoiceEditSchema, input)
  db.transaction(() => {
    const cur = loadInvoice(db, e.id)
    if (!isInvoiceEditable(cur)) throw new UserError(`${cur.number} is ${cur.archived_at ? 'archived' : cur.status === 'void' ? 'void' : 'already sent'} and can’t be changed.`)
    checkCustomer(db, e.customer_id, e.contact_id)
    writeInvoice(db, e, invoicePricing(db, { ...cur, ...e }, today))
    const last = db.prepare(`SELECT action, created_at FROM activity_log WHERE entity_type = 'invoice' AND entity_id = ? ORDER BY id DESC LIMIT 1`).get(e.id) as
      | { action: string; created_at: string }
      | undefined
    if (!last || last.action !== 'edited' || Date.now() - Date.parse(last.created_at) > 10 * 60_000) logActivity(db, 'invoice', e.id, 'edited')
  })()
  return getInvoiceDetail(db, e.id, today)
}

export function markInvoiceSent(db: DB, id: number, today: string): InvoiceRecord {
  return db.transaction(() => {
    const inv = loadInvoice(db, id)
    if (inv.status === 'void') throw new UserError(`${inv.number} is void`)
    if (inv.archived_at) throw new UserError('Restore the invoice first')
    if (!inv.customer_id) throw new UserError('Pick a customer first')
    if (inv.sent_at) return inv
    {
      // Freeze the pricing it goes out with.
      const b = writeInvoice(db, inv, invoicePricing(db, inv, today))
      if (b.total_pieces === 0 && !inv.fees.length) throw new UserError('Add something to bill first')
    }
    db.prepare('UPDATE invoices SET sent_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id)
    recomputeInvoice(db, id)
    logActivity(db, 'invoice', id, 'sent')
    return loadInvoice(db, id)
  })()
}

export function voidInvoice(db: DB, id: number, reason: string): InvoiceRecord {
  return db.transaction(() => {
    const inv = loadInvoice(db, id)
    if (inv.status === 'void') return inv
    if (paidOn(db, { invoice_id: id }) > 0) throw new UserError('This invoice has payments. Void or refund them first.')
    db.prepare(`UPDATE invoices SET status = 'void', voided_at = ?, void_reason = ?, balance_cents = 0, updated_at = ? WHERE id = ?`).run(now(), reason.trim().slice(0, 300), now(), id)
    // The quote can be invoiced again.
    if (inv.source_quote_id) db.prepare('UPDATE quotes SET converted_invoice_id = NULL WHERE id = ? AND converted_invoice_id = ?').run(inv.source_quote_id, id)
    logActivity(db, 'invoice', id, 'voided', reason.trim() ? { reason: reason.trim() } : {})
    return loadInvoice(db, id)
  })()
}

/** Drop the quote's frozen pricing on a draft invoice and price it with today's rules. */
export function repriceInvoice(db: DB, id: number, today: string): InvoiceRecord {
  return db.transaction(() => {
    const inv = loadInvoice(db, id)
    if (!isInvoiceEditable(inv)) throw new UserError('Only unsent invoices can be repriced')
    db.prepare('UPDATE invoices SET pricing_locked = 0 WHERE id = ?').run(id)
    const unlocked = { ...inv, pricing_locked: false }
    writeInvoice(db, unlocked, invoicePricing(db, unlocked, today))
    logActivity(db, 'invoice', id, 'repriced')
    return loadInvoice(db, id)
  })()
}

export function setInvoiceArchived(db: DB, id: number, archived: boolean): InvoiceRecord {
  return db.transaction(() => {
    loadInvoice(db, id)
    db.prepare('UPDATE invoices SET archived_at = ?, updated_at = ? WHERE id = ?').run(archived ? now() : null, now(), id)
    logActivity(db, 'invoice', id, archived ? 'archived' : 'restored')
    return loadInvoice(db, id)
  })()
}

/** Invoices count and money owed (issued, not void, unpaid balance; negative = credit). */
export function customerInvoiceStats(db: DB, customerId: number): { count: number; balance_cents: number } {
  return db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN status NOT IN ('draft', 'void') THEN balance_cents ELSE 0 END), 0) AS balance_cents
       FROM invoices WHERE customer_id = ? AND archived_at IS NULL AND status <> 'void'`
    )
    .get(customerId) as { count: number; balance_cents: number }
}
