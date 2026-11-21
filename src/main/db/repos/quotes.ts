import type Database from 'better-sqlite3'
import { addDays } from '@shared/dates'
import type { QuoteFilter } from '@shared/ipc'
import type { QuoteBreakdown } from '@shared/pricing/types'
import {
  buildPricingBase,
  isEditable,
  priceQuoteDoc,
  QuoteEditSchema,
  type FrozenPricing,
  type PricingBase,
  type QuoteDetail,
  type QuoteTotals,
  type QuoteCustomerSummary,
  type QuoteEdit,
  type QuoteFee,
  type QuoteImprint,
  type QuoteLine,
  type QuoteListRow,
  type QuoteRecord,
  type QuoteStatus
} from '@shared/quote'
import { customerDisplayName } from '@shared/schemas'
import { NotFoundError, parseOrThrow, UserError } from '../errors'
import { fromRow, insert, likePattern, now, toRow, update } from '../rows'
import { listActivity, logActivity } from './activity'
import { listAttachments } from './attachments'
import { getCustomer } from './customers'
import { getRules, listFees, listMatrices } from './pricing'
import { allocateNumber, getSettings } from './settings'

type DB = Database.Database

const QUOTE = { bool: ['rush', 'charge_tax_anyway', 'is_reorder'], json: ['disabled_auto_fees'] } as const
const LINE = { bool: ['customer_supplied', 'is_dark'], json: ['garment', 'costs', 'overrides', 'calculated'] } as const
const IMPRINT = { bool: ['underbase', 'new_digitizing', 'is_reorder'], json: ['specialty'] } as const
const FEE = { bool: ['taxable'] } as const
const EDIT_FIELDS = (Object.keys(QuoteEditSchema.shape) as (keyof QuoteEdit)[]).filter((k) => k !== 'id' && k !== 'lines' && k !== 'fees')

// ---------- pricing configuration ----------
/** Live pricing config: current rules, active matrices plus any archived ones a quote still references. */
export function livePricingBase(db: DB, referencedMatrixIds: number[] = []): PricingBase {
  const all = listMatrices(db, true)
  const matrices = all.filter((m) => !m.archived_at || referencedMatrixIds.includes(m.id))
  return buildPricingBase(getRules(db), matrices, getSettings(db), listFees(db, true))
}

function customerSummary(db: DB, id: number | null): QuoteCustomerSummary | null {
  if (id == null) return null
  const c = getCustomer(db, id)
  const addr = (k: 'billing' | 'shipping') => {
    const f = (s: string) => (c as unknown as Record<string, string>)[`${k}_${s}`] ?? ''
    return [f('line1'), f('line2'), [f('city'), [f('state'), f('postal_code')].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean)
  }
  const billing = addr('billing')
  return {
    id: c.id,
    display_name: customerDisplayName(c),
    company_name: c.company_name,
    first_name: c.first_name,
    last_name: c.last_name,
    email: c.email,
    phone: c.phone,
    billing,
    shipping: c.shipping_same_as_billing ? billing : addr('shipping'),
    tax_exempt: c.tax_exempt,
    exempt_cert_number: c.exempt_cert_number,
    exempt_cert_expires_on: c.exempt_cert_expires_on,
    pricing_matrix_id: c.pricing_matrix_id
  }
}

// ---------- reading ----------
function quoteRow(db: DB, id: number): Record<string, unknown> {
  const row = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) throw new NotFoundError('Quote', id)
  return row
}

export function loadQuote(db: DB, id: number): QuoteRecord {
  const { pricing_base: _p, totals: _t, ...row } = quoteRow(db, id)
  const q = fromRow<Omit<QuoteRecord, 'lines' | 'fees'>>(row, QUOTE)
  const lineRows = db.prepare('SELECT * FROM quote_line_items WHERE quote_id = ? ORDER BY sort_order').all(id) as Record<string, unknown>[]
  const sizeStmt = db.prepare('SELECT size, qty FROM quote_line_sizes WHERE line_item_id = ? ORDER BY sort_order')
  const impStmt = db.prepare('SELECT * FROM quote_imprints WHERE line_item_id = ? ORDER BY sort_order')
  const lines: QuoteLine[] = lineRows.map((r) => {
    const l = fromRow<Record<string, unknown>>(r, LINE)
    return {
      uid: l.uid as string,
      garment_id: l.garment_id as number | null,
      garment: l.garment as QuoteLine['garment'],
      costs: l.costs as QuoteLine['costs'],
      description: l.description as string,
      customer_supplied: l.customer_supplied as boolean,
      color_name: l.color_name as string,
      color_hex: l.color_hex as string,
      is_dark: l.is_dark as boolean,
      sizes: sizeStmt.all(r.id) as QuoteLine['sizes'],
      imprints: (impStmt.all(r.id) as Record<string, unknown>[]).map((ir) => {
        const { id: _id, line_item_id: _l, sort_order: _s, artwork_attachment_id: _a, ...i } = fromRow<Record<string, unknown>>(ir, IMPRINT)
        return i as unknown as QuoteImprint
      }),
      overrides: l.overrides as QuoteLine['overrides'],
      override_reason: l.override_reason as string
    }
  })
  const fees = (db.prepare('SELECT * FROM quote_fees WHERE quote_id = ? ORDER BY sort_order').all(id) as Record<string, unknown>[]).map((r) => {
    const { id: _id, quote_id: _q, sort_order: _s, ...f } = fromRow<Record<string, unknown>>(r, FEE)
    return f as unknown as QuoteFee
  })
  return { ...q, lines, fees }
}

function frozenPricing(db: DB, id: number): FrozenPricing | null {
  const raw = (db.prepare('SELECT pricing_base FROM quotes WHERE id = ?').get(id) as { pricing_base: string | null }).pricing_base
  return raw ? (JSON.parse(raw) as FrozenPricing) : null
}

function referencedMatrices(q: QuoteEdit): number[] {
  return q.lines.flatMap((l) => l.imprints.map((i) => i.matrix_id).filter((x): x is number => x != null))
}

/** The pricing a quote should be shown with right now. */
export function effectivePricing(db: DB, q: QuoteRecord, today: string): FrozenPricing {
  if (q.status !== 'draft') {
    const f = frozenPricing(db, q.id)
    if (f) return f
  }
  const c = customerSummary(db, q.customer_id)
  return { base: livePricingBase(db, referencedMatrices(q)), customer: c && { tax_exempt: c.tax_exempt, exempt_cert_expires_on: c.exempt_cert_expires_on, pricing_matrix_id: c.pricing_matrix_id }, priced_on: today }
}

export function priceWith(q: QuoteEdit, p: FrozenPricing): QuoteBreakdown {
  return priceQuoteDoc(q, p.base, p.customer as QuoteCustomerSummary | null, p.priced_on)
}

export function getQuoteDetail(db: DB, id: number, today: string): QuoteDetail {
  const quote = loadQuote(db, id)
  const pricing = effectivePricing(db, quote, today)
  const revisions = db
    .prepare('SELECT id, number, revision, status, total_cents, updated_at FROM quotes WHERE root_number = ? ORDER BY revision')
    .all(quote.root_number) as QuoteDetail['revisions']
  return {
    quote,
    customer: customerSummary(db, quote.customer_id),
    pricing,
    breakdown: priceWith(quote, pricing),
    attachments: listAttachments(db, 'quote', id),
    activity: listActivity(db, 'quote', id),
    revisions
  }
}

export function listQuotes(db: DB, f: QuoteFilter = {}): QuoteListRow[] {
  const where: string[] = []
  const p: Record<string, unknown> = {}
  if (!f.includeArchived) where.push('q.archived_at IS NULL')
  if (f.status === 'open') where.push(`q.status IN ('draft', 'sent')`)
  else if (f.status) {
    where.push('q.status = @status')
    p.status = f.status
  } else if (!f.includeSuperseded) where.push(`q.status <> 'superseded'`)
  if (f.customer_id) {
    where.push('q.customer_id = @cid')
    p.cid = f.customer_id
  }
  if (f.from) {
    where.push('q.issued_on >= @from')
    p.from = f.from
  }
  if (f.to) {
    where.push('q.issued_on <= @to')
    p.to = f.to
  }
  if (f.search?.trim()) {
    p.q = likePattern(f.search.trim())
    where.push(`(q.number LIKE @q ESCAPE '\\' OR q.job_name LIKE @q ESCAPE '\\' OR c.company_name LIKE @q ESCAPE '\\' OR (c.first_name || ' ' || c.last_name) LIKE @q ESCAPE '\\')`)
  }
  const rows = db
    .prepare(
      `SELECT q.id, q.number, q.revision, q.customer_id, q.job_name, q.status, q.total_cents, q.issued_on, q.expires_on, q.in_hands_on, q.archived_at, q.updated_at,
         c.company_name, c.first_name, c.last_name
       FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY q.issued_on DESC, q.id DESC`
    )
    .all(p) as Array<QuoteListRow & { company_name: string | null; first_name: string | null; last_name: string | null }>
  return rows.map(({ company_name, first_name, last_name, ...r }) => ({
    ...r,
    customer_name: r.customer_id ? customerDisplayName({ company_name: company_name ?? '', first_name: first_name ?? '', last_name: last_name ?? '' }) : ''
  }))
}

// ---------- writing ----------
function totalsOf(b: QuoteBreakdown): QuoteTotals {
  return {
    pieces: b.total_pieces,
    items_subtotal_cents: b.items_subtotal_cents,
    fees_subtotal_cents: b.fees_subtotal_cents,
    subtotal_cents: b.subtotal_cents,
    discount_cents: b.discount_cents,
    rush_cents: b.rush_cents,
    shipping_cents: b.shipping_cents,
    taxable_cents: b.taxable_cents,
    tax_bp: b.tax_bp,
    tax_cents: b.tax_cents,
    total_cents: b.total_cents,
    deposit_cents: b.deposit_cents,
    cost_cents: b.cost_cents,
    profit_cents: b.profit_cents,
    margin_bp: b.margin_bp
  }
}

export function getQuoteTotals(db: DB, id: number): QuoteTotals {
  return JSON.parse((db.prepare('SELECT totals FROM quotes WHERE id = ?').get(id) as { totals: string }).totals) as QuoteTotals
}

/** Write the editable fields and replace all child rows; recompute and store prices. */
function writeQuote(db: DB, q: QuoteEdit, pricing: FrozenPricing): QuoteBreakdown {
  const b = priceWith(q, pricing)
  const { lines, fees, id } = q
  // Only the editable fields; status, numbers and timestamps change through actions.
  const fields = Object.fromEntries(EDIT_FIELDS.map((k) => [k, q[k]]))
  update(db, 'quotes', id, {
    ...toRow(fields, QUOTE),
    pricing_base: JSON.stringify(pricing),
    totals: JSON.stringify(totalsOf(b)),
    total_cents: b.total_cents
  })
  db.prepare('DELETE FROM quote_line_items WHERE quote_id = ?').run(id)
  db.prepare('DELETE FROM quote_fees WHERE quote_id = ?').run(id)
  const insSize = db.prepare('INSERT INTO quote_line_sizes (line_item_id, size, qty, sort_order) VALUES (?, ?, ?, ?)')
  lines.forEach((l, i) => {
    const lb = b.lines[i]
    const { sizes, imprints, ...lineFields } = l
    const lineId = insert(db, 'quote_line_items', {
      ...toRow(lineFields as Record<string, unknown>, LINE),
      quote_id: id,
      sort_order: i,
      calculated: JSON.stringify(lb.groups.map((g) => ({ group: g.group, unit_cents: g.calculated_unit_cents }))),
      total_cents: lb.total_cents
    })
    sizes.forEach((s, j) => insSize.run(lineId, s.size, s.qty, j))
    imprints.forEach((imp, j) => insert(db, 'quote_imprints', { ...toRow(imp as unknown as Record<string, unknown>, IMPRINT), line_item_id: lineId, sort_order: j }))
  })
  fees.forEach((f, i) => insert(db, 'quote_fees', { ...toRow(f as unknown as Record<string, unknown>, FEE), quote_id: id, sort_order: i }))
  return b
}

function checkCustomer(db: DB, customerId: number | null, contactId: number | null): void {
  if (customerId == null) {
    if (contactId != null) throw new UserError('Pick a customer before a contact')
    return
  }
  const c = getCustomer(db, customerId)
  if (c.archived_at) throw new UserError(`${customerDisplayName(c)} is archived. Restore the customer first.`)
  if (contactId != null) {
    const k = db.prepare('SELECT customer_id FROM customer_contacts WHERE id = ?').get(contactId) as { customer_id: number } | undefined
    if (!k || k.customer_id !== customerId) throw new UserError('That contact belongs to a different customer')
  }
}

export function createQuote(db: DB, opts: { customer_id?: number | null }, today: string): QuoteRecord {
  return db.transaction(() => {
    const s = getSettings(db)
    checkCustomer(db, opts.customer_id ?? null, null)
    const { number } = allocateNumber(db, 'quote')
    const id = insert(db, 'quotes', {
      number,
      root_number: number,
      revision: 1,
      status: 'draft',
      customer_id: opts.customer_id ?? null,
      issued_on: today,
      expires_on: s.quote_expiration_days ? addDays(today, s.quote_expiration_days) : null,
      deposit_bp: s.default_deposit_bp
    })
    const q = loadQuote(db, id)
    writeQuote(db, q, effectivePricing(db, q, today))
    logActivity(db, 'quote', id, 'created')
    return loadQuote(db, id)
  })()
}

/** Autosave target. Only drafts change; anything else must be revised. */
export function saveQuote(db: DB, input: QuoteEdit, today: string): QuoteDetail {
  const q = parseOrThrow(QuoteEditSchema, input)
  db.transaction(() => {
    const current = loadQuote(db, q.id)
    if (!isEditable(current)) throw new UserError(`${current.number} is ${current.status === 'draft' ? 'archived' : current.status}. Use “Revise” to make changes.`)
    checkCustomer(db, q.customer_id, q.contact_id)
    writeQuote(db, q, effectivePricing(db, { ...current, ...q }, today))
    // Autosave runs constantly; log at most one "edited" entry per 10 minutes.
    const last = db.prepare(`SELECT action, created_at FROM activity_log WHERE entity_type = 'quote' AND entity_id = ? ORDER BY id DESC LIMIT 1`).get(q.id) as
      | { action: string; created_at: string }
      | undefined
    if (!last || last.action !== 'edited' || Date.now() - Date.parse(last.created_at) > 10 * 60_000) logActivity(db, 'quote', q.id, 'edited')
  })()
  return getQuoteDetail(db, q.id, today)
}

function setStatus(db: DB, id: number, status: QuoteStatus, extra: Record<string, unknown> = {}): void {
  db.prepare(`UPDATE quotes SET status = @status, ${Object.keys(extra).map((k) => `${k} = @${k}`).concat('updated_at = @updated_at').join(', ')} WHERE id = @id`).run({ ...extra, status, id, updated_at: now() })
}

/** Re-price a draft with today's config and freeze it, as it leaves draft. */
function freeze(db: DB, q: QuoteRecord, today: string): QuoteBreakdown {
  const pricing = effectivePricing(db, { ...q, status: 'draft' }, today)
  return writeQuote(db, q, pricing)
}

function requireSendable(q: QuoteRecord, b: QuoteBreakdown): void {
  if (!q.customer_id) throw new UserError('Pick a customer first')
  if (!q.lines.length || b.total_pieces === 0) throw new UserError('Add at least one line item with quantities')
}

export function markSent(db: DB, id: number, today: string): QuoteRecord {
  return db.transaction(() => {
    const q = loadQuote(db, id)
    if (q.archived_at) throw new UserError('Restore the quote first')
    if (q.status === 'sent') return q
    if (q.status !== 'draft') throw new UserError(`Only drafts can be marked as sent (this quote is ${q.status})`)
    requireSendable(q, freeze(db, q, today))
    setStatus(db, id, 'sent', { sent_at: now() })
    logActivity(db, 'quote', id, 'sent')
    return loadQuote(db, id)
  })()
}

export function approveQuote(db: DB, id: number, approvedBy: string, today: string): QuoteRecord {
  return db.transaction(() => {
    const q = loadQuote(db, id)
    if (q.archived_at) throw new UserError('Restore the quote first')
    if (!['draft', 'sent', 'expired'].includes(q.status)) throw new UserError(`A ${q.status} quote can’t be approved`)
    if (q.status === 'draft') requireSendable(q, freeze(db, q, today))
    setStatus(db, id, 'approved', { approved_at: now(), approved_by_name: approvedBy.trim().slice(0, 200) })
    logActivity(db, 'quote', id, 'approved', approvedBy.trim() ? { by: approvedBy.trim() } : {})
    return loadQuote(db, id)
  })()
}

export function declineQuote(db: DB, id: number, reason: string): QuoteRecord {
  return db.transaction(() => {
    const q = loadQuote(db, id)
    if (!['sent', 'expired', 'draft'].includes(q.status)) throw new UserError(`A ${q.status} quote can’t be declined`)
    setStatus(db, id, 'declined', { declined_at: now() })
    logActivity(db, 'quote', id, 'declined', reason.trim() ? { reason: reason.trim().slice(0, 500) } : {})
    return loadQuote(db, id)
  })()
}

/** Mark sent quotes past their expiration date as expired. Returns how many changed. */
export function expireQuotes(db: DB, today: string): number {
  return db.transaction(() => {
    const ids = (db.prepare(`SELECT id FROM quotes WHERE status = 'sent' AND expires_on IS NOT NULL AND expires_on < ?`).all(today) as { id: number }[]).map((r) => r.id)
    for (const id of ids) {
      setStatus(db, id, 'expired')
      logActivity(db, 'quote', id, 'expired')
    }
    return ids.length
  })()
}

function copyInto(db: DB, src: QuoteRecord, target: { number: string; root_number: string; revision: number; previous_revision_id: number | null; reorder_of_id: number | null }, today: string, mutate?: (q: QuoteEdit) => QuoteEdit): number {
  const s = getSettings(db)
  const id = insert(db, 'quotes', {
    ...target,
    status: 'draft',
    customer_id: src.customer_id,
    issued_on: today,
    expires_on: s.quote_expiration_days ? addDays(today, s.quote_expiration_days) : null
  })
  const { id: _id, number: _n, root_number: _r, revision: _v, previous_revision_id: _p, reorder_of_id: _o, status: _s, sent_at: _sa, approved_at: _aa, approved_by_name: _ab, declined_at: _d, converted_invoice_id: _c, total_cents: _t, created_at: _ca, updated_at: _ua, archived_at: _ar, ...edit } = src
  let next: QuoteEdit = { ...edit, id, issued_on: today, expires_on: s.quote_expiration_days ? addDays(today, s.quote_expiration_days) : null }
  if (mutate) next = mutate(next)
  const fresh = loadQuote(db, id)
  writeQuote(db, next, effectivePricing(db, { ...fresh, ...next }, today))
  return id
}

/** New draft revision (Q-1001-R2) with the same content; the old one becomes read-only history. */
export function reviseQuote(db: DB, id: number, today: string): QuoteRecord {
  return db.transaction(() => {
    const q = loadQuote(db, id)
    if (q.status === 'draft') throw new UserError('Drafts can be edited directly')
    if (q.status === 'superseded') throw new UserError('This revision was already replaced. Revise the latest one.')
    if (q.converted_invoice_id) throw new UserError('This quote was converted to an invoice')
    const max = (db.prepare('SELECT MAX(revision) AS r FROM quotes WHERE root_number = ?').get(q.root_number) as { r: number }).r
    const number = `${q.root_number}-R${max + 1}`
    const newId = copyInto(db, q, { number, root_number: q.root_number, revision: max + 1, previous_revision_id: q.id, reorder_of_id: q.reorder_of_id }, today, (e) => ({ ...e, issued_on: today }))
    setStatus(db, id, 'superseded')
    logActivity(db, 'quote', id, 'revised', { new_number: number })
    logActivity(db, 'quote', newId, 'created', { revision_of: q.number })
    return loadQuote(db, newId)
  })()
}

export function duplicateQuote(db: DB, id: number, today: string, asReorder = false): QuoteRecord {
  return db.transaction(() => {
    const q = loadQuote(db, id)
    const { number } = allocateNumber(db, 'quote')
    const newId = copyInto(db, q, { number, root_number: number, revision: 1, previous_revision_id: null, reorder_of_id: asReorder ? q.id : null }, today, (e) =>
      asReorder
        ? {
            ...e,
            is_reorder: true,
            in_hands_on: null,
            // Screens from the original job are reused.
            lines: e.lines.map((l) => ({ ...l, imprints: l.imprints.map((i) => (i.method === 'screen' ? { ...i, is_reorder: true } : i)) }))
          }
        : { ...e, in_hands_on: null }
    )
    logActivity(db, 'quote', newId, 'created', asReorder ? { reorder_of: q.number } : { copied_from: q.number })
    return loadQuote(db, newId)
  })()
}

export function setQuoteArchived(db: DB, id: number, archived: boolean): QuoteRecord {
  return db.transaction(() => {
    loadQuote(db, id)
    db.prepare('UPDATE quotes SET archived_at = ?, updated_at = ? WHERE id = ?').run(archived ? now() : null, now(), id)
    logActivity(db, 'quote', id, archived ? 'archived' : 'restored')
    return loadQuote(db, id)
  })()
}

export function customerQuoteStats(db: DB, customerId: number): { count: number } {
  return db.prepare(`SELECT COUNT(*) AS count FROM quotes WHERE customer_id = ? AND archived_at IS NULL AND status <> 'superseded'`).get(customerId) as { count: number }
}
