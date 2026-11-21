/**
 * Storage shared by quotes and invoices: both are a priced document with line items (sizes,
 * imprints) and fees, saved whole. Table names differ only by prefix.
 */
import type Database from 'better-sqlite3'
import type { QuoteBreakdown } from '@shared/pricing/types'
import { buildPricingBase, type PricingBase, type QuoteCustomerSummary, type QuoteFee, type QuoteImprint, type QuoteLine, type QuoteTotals } from '@shared/quote'
import { customerDisplayName } from '@shared/schemas'
import { UserError } from '../errors'
import { fromRow, insert, toRow } from '../rows'
import { getCustomer } from './customers'
import { getRules, listFees, listMatrices } from './pricing'
import { getSettings } from './settings'

type DB = Database.Database
export type DocKind = 'quote' | 'invoice'

const TABLES = {
  quote: { lines: 'quote_line_items', sizes: 'quote_line_sizes', imprints: 'quote_imprints', fees: 'quote_fees', fk: 'quote_id' },
  invoice: { lines: 'invoice_line_items', sizes: 'invoice_line_sizes', imprints: 'invoice_imprints', fees: 'invoice_fees', fk: 'invoice_id' }
} as const

const LINE = { bool: ['customer_supplied', 'is_dark'], json: ['garment', 'costs', 'overrides', 'calculated'] } as const
const IMPRINT = { bool: ['underbase', 'new_digitizing', 'is_reorder'], json: ['specialty'] } as const
const FEE = { bool: ['taxable'] } as const

export function loadChildren(db: DB, kind: DocKind, id: number): { lines: QuoteLine[]; fees: QuoteFee[] } {
  const t = TABLES[kind]
  const lineRows = db.prepare(`SELECT * FROM ${t.lines} WHERE ${t.fk} = ? ORDER BY sort_order`).all(id) as Record<string, unknown>[]
  const sizeStmt = db.prepare(`SELECT size, qty FROM ${t.sizes} WHERE line_item_id = ? ORDER BY sort_order`)
  const impStmt = db.prepare(`SELECT * FROM ${t.imprints} WHERE line_item_id = ? ORDER BY sort_order`)
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
  const fees = (db.prepare(`SELECT * FROM ${t.fees} WHERE ${t.fk} = ? ORDER BY sort_order`).all(id) as Record<string, unknown>[]).map((r) => {
    const { id: _id, sort_order: _s, ...rest } = fromRow<Record<string, unknown>>(r, FEE)
    delete rest[t.fk]
    return rest as unknown as QuoteFee
  })
  return { lines, fees }
}

/** Replace all lines, sizes, imprints and fees of a document. */
export function writeChildren(db: DB, kind: DocKind, id: number, lines: QuoteLine[], fees: QuoteFee[], b: QuoteBreakdown): void {
  const t = TABLES[kind]
  db.prepare(`DELETE FROM ${t.lines} WHERE ${t.fk} = ?`).run(id)
  db.prepare(`DELETE FROM ${t.fees} WHERE ${t.fk} = ?`).run(id)
  const insSize = db.prepare(`INSERT INTO ${t.sizes} (line_item_id, size, qty, sort_order) VALUES (?, ?, ?, ?)`)
  lines.forEach((l, i) => {
    const lb = b.lines[i]
    const { sizes, imprints, ...lineFields } = l
    const lineId = insert(db, t.lines, {
      ...toRow(lineFields as Record<string, unknown>, LINE),
      [t.fk]: id,
      sort_order: i,
      calculated: JSON.stringify(lb.groups.map((g) => ({ group: g.group, unit_cents: g.calculated_unit_cents }))),
      total_cents: lb.total_cents
    })
    sizes.forEach((s, j) => insSize.run(lineId, s.size, s.qty, j))
    imprints.forEach((imp, j) => insert(db, t.imprints, { ...toRow(imp as unknown as Record<string, unknown>, IMPRINT), line_item_id: lineId, sort_order: j }))
  })
  fees.forEach((f, i) => insert(db, t.fees, { ...toRow(f as unknown as Record<string, unknown>, FEE), [t.fk]: id, sort_order: i }))
}

/** Live pricing config: current rules, active matrices plus any archived ones a document still references. */
export function livePricingBase(db: DB, referencedMatrixIds: number[] = []): PricingBase {
  const matrices = listMatrices(db, true).filter((m) => !m.archived_at || referencedMatrixIds.includes(m.id))
  return buildPricingBase(getRules(db), matrices, getSettings(db), listFees(db, true))
}

export function referencedMatrices(lines: QuoteLine[]): number[] {
  return lines.flatMap((l) => l.imprints.map((i) => i.matrix_id).filter((x): x is number => x != null))
}

export function customerSummary(db: DB, id: number | null): QuoteCustomerSummary | null {
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

export function checkCustomer(db: DB, customerId: number | null, contactId: number | null): void {
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

export function totalsOf(b: QuoteBreakdown): QuoteTotals {
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
    margin_bp: b.margin_bp,
    net_sales_cents: b.subtotal_cents - b.discount_cents + b.rush_cents,
    tax_exempt: b.tax_exempt_applied
  }
}
