import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../../src/main/db/migrate'
import { seedIfEmpty } from '../../src/main/db/seed'
import { getCustomerDetail, listCustomers, saveCustomer } from '../../src/main/db/repos/customers'
import { listGarments } from '../../src/main/db/repos/garments'
import {
  convertQuote,
  createInvoice,
  getInvoiceDetail,
  listInvoices,
  loadInvoice,
  markInvoiceSent,
  repriceInvoice,
  saveInvoice,
  voidInvoice
} from '../../src/main/db/repos/invoices'
import { listPayments, recordPayment, voidPayment } from '../../src/main/db/repos/payments'
import { getRules, saveRules } from '../../src/main/db/repos/pricing'
import { approveQuote, createQuote, getQuoteDetail, loadQuote, markSent, reviseQuote, saveQuote } from '../../src/main/db/repos/quotes'
import { editableSettings, getSettings, saveSettings } from '../../src/main/db/repos/settings'
import { invoiceDisplayStatus, InvoiceEditSchema, type InvoiceEdit, type InvoiceRecord, type PaymentInput } from '../../src/shared/invoice'
import { newImprint, newLine, QuoteEditSchema, type QuoteEdit, type QuoteRecord } from '../../src/shared/quote'
import type { CustomerInput } from '../../src/shared/schemas'

const TODAY = '2026-11-21'
let db: Database.Database
let customerId: number

const customer: CustomerInput = {
  company_name: 'Riverside Brewing', first_name: 'Dana', last_name: 'Ortiz', email: 'dana@example.com', phone: '',
  billing_line1: '', billing_line2: '', billing_city: '', billing_state: '', billing_postal_code: '',
  shipping_same_as_billing: true, shipping_line1: '', shipping_line2: '', shipping_city: '', shipping_state: '', shipping_postal_code: '',
  tax_exempt: false, exempt_cert_number: '', exempt_cert_attachment_id: null, exempt_cert_expires_on: null, pricing_matrix_id: null, notes: '', tags: []
}

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  seedIfEmpty(db)
  customerId = saveCustomer(db, customer).id
  saveSettings(db, { ...editableSettings(getSettings(db)), payment_terms: 'net_15', default_tax_bp: 800 })
})

const pick = <T extends object>(schema: { shape: object }, r: object): T => Object.fromEntries(Object.keys(schema.shape).map((k) => [k, (r as Record<string, unknown>)[k]])) as T
const qEdit = (q: QuoteRecord) => pick<QuoteEdit>(QuoteEditSchema, q)
const iEdit = (i: InvoiceRecord) => pick<InvoiceEdit>(InvoiceEditSchema, i)

/** 24 × Gildan 5000 with a 1-color front: 24 × $8.25 + $25 screen = $223.00 + 8% tax = $240.84 */
function approvedQuote(): QuoteRecord {
  const q = createQuote(db, { customer_id: customerId }, TODAY)
  const g = listGarments(db, { search: 'gildan 5000' })[0]
  const line = newLine({
    garment_id: g.id,
    garment: { brand: g.brand, style_number: g.style_number, name: g.name, category: g.category, supplier: g.supplier, supplier_other: '' },
    costs: { base: g.cost_base_cents, '2xl': g.cost_2xl_cents, '3xl': g.cost_3xl_cents, '4xl_plus': g.cost_4xl_plus_cents },
    color_name: 'White',
    sizes: [{ size: 'M', qty: 24 }],
    imprints: [newImprint({ colors: 1 })]
  })
  saveQuote(db, { ...qEdit(q), job_name: 'Staff tees', internal_notes: 'internal', lines: [line] }, TODAY)
  markSent(db, q.id, TODAY)
  approveQuote(db, q.id, 'Dana', TODAY)
  return loadQuote(db, q.id)
}

const pay = (over: Partial<PaymentInput>): PaymentInput => ({
  invoice_id: null,
  quote_id: null,
  received_on: TODAY,
  amount_cents: 1000,
  method: 'check',
  check_number: '1042',
  reference: '',
  note: '',
  is_deposit: false,
  ...over
})

describe('converting a quote', () => {
  it('copies lines and frozen prices, links both ways', () => {
    const q = approvedQuote()
    const inv = convertQuote(db, q.id, '2026-11-25')
    expect(inv).toMatchObject({ number: 'INV-1001', source_quote_id: q.id, status: 'draft', job_name: 'Staff tees', issued_on: '2026-11-25', due_on: '2026-12-10', payment_terms: 'Net 15', pricing_locked: true })
    expect(inv.lines).toEqual(q.lines)
    expect(inv.total_cents).toBe(24084)
    expect(inv.total_cents).toBe(q.total_cents)
    expect(loadQuote(db, q.id).converted_invoice_id).toBe(inv.id)
    expect(getQuoteDetail(db, q.id, TODAY).converted_invoice).toEqual({ id: inv.id, number: 'INV-1001' })
    expect(getInvoiceDetail(db, inv.id, TODAY).source_quote).toEqual({ id: q.id, number: q.number })
    expect(getQuoteDetail(db, q.id, TODAY).activity[0]).toMatchObject({ action: 'converted', details: { invoice: 'INV-1001' } })
  })

  it('keeps the quote’s prices even when rules change, until repriced', () => {
    const q = approvedQuote()
    saveRules(db, { ...getRules(db), screen_fee_cents: 5000 })
    const inv = convertQuote(db, q.id, TODAY)
    expect(inv.total_cents).toBe(24084)
    // editing a draft converted invoice still uses the quote's pricing
    saveInvoice(db, { ...iEdit(inv), po_number: 'PO-9' }, TODAY)
    expect(loadInvoice(db, inv.id).total_cents).toBe(24084)
    expect(repriceInvoice(db, inv.id, TODAY).total_cents).toBe(Math.round((19800 + 5000) * 1.08))
  })

  it('only approved quotes, only once', () => {
    const q = createQuote(db, { customer_id: customerId }, TODAY)
    expect(() => convertQuote(db, q.id, TODAY)).toThrow(/Only approved quotes/)
    const a = approvedQuote()
    convertQuote(db, a.id, TODAY)
    expect(() => convertQuote(db, a.id, TODAY)).toThrow(/already converted to INV-1001/)
    expect(() => reviseQuote(db, a.id, TODAY)).toThrow(/converted/)
  })

  it('a deposit on the quote carries over as a payment', () => {
    const q = approvedQuote()
    recordPayment(db, pay({ quote_id: q.id, amount_cents: 12042, method: 'venmo' }))
    expect(getQuoteDetail(db, q.id, TODAY).breakdown.balance_cents).toBe(24084 - 12042)
    const inv = convertQuote(db, q.id, TODAY)
    expect(inv).toMatchObject({ paid_cents: 12042, balance_cents: 12042, status: 'partially_paid' })
    const payments = listPayments(db, { invoice_id: inv.id })
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({ is_deposit: true, receipt_number: 'R-1001', applied_to: 'INV-1001' })
    expect(() => recordPayment(db, pay({ quote_id: q.id }))).toThrow(/already invoiced/)
  })

  it('deposits follow a revised quote', () => {
    const q = createQuote(db, { customer_id: customerId }, TODAY)
    saveQuote(db, { ...qEdit(q), lines: [newLine({ sizes: [{ size: 'M', qty: 12 }] })] }, TODAY)
    markSent(db, q.id, TODAY)
    recordPayment(db, pay({ quote_id: q.id, amount_cents: 5000 }))
    const r2 = reviseQuote(db, q.id, TODAY)
    expect(listPayments(db, { quote_id: r2.id }).map((p) => p.amount_cents)).toEqual([5000])
  })
})

describe('payments and statuses', () => {
  it('draft → sent → partially paid → paid, and back when a payment is voided', () => {
    const inv = convertQuote(db, approvedQuote().id, TODAY)
    expect(markInvoiceSent(db, inv.id, TODAY).status).toBe('sent')
    const p1 = recordPayment(db, pay({ invoice_id: inv.id, amount_cents: 10000 }))
    expect(loadInvoice(db, inv.id)).toMatchObject({ status: 'partially_paid', paid_cents: 10000, balance_cents: 14084 })
    recordPayment(db, pay({ invoice_id: inv.id, amount_cents: 14084, method: 'cash' }))
    const paid = loadInvoice(db, inv.id)
    expect(paid).toMatchObject({ status: 'paid', balance_cents: 0 })
    expect(paid.paid_at).toBeTruthy()
    voidPayment(db, p1.id, 'Bounced')
    expect(loadInvoice(db, inv.id)).toMatchObject({ status: 'partially_paid', balance_cents: 10000, paid_at: null })
    expect(getInvoiceDetail(db, inv.id, TODAY).activity.map((a) => a.action)).toContain('payment voided')
  })

  it('payments don’t lock an unsent invoice; sending does', () => {
    const inv = convertQuote(db, approvedQuote().id, TODAY)
    recordPayment(db, pay({ invoice_id: inv.id, amount_cents: 500 }))
    // final count changed after the deposit: 24 → 26
    const e = iEdit(loadInvoice(db, inv.id))
    e.lines[0].sizes = [{ size: 'M', qty: 26 }]
    saveInvoice(db, e, TODAY)
    expect(loadInvoice(db, inv.id)).toMatchObject({ total_cents: Math.round((26 * 825 + 2500) * 1.08), paid_cents: 500, status: 'partially_paid' })
    markInvoiceSent(db, inv.id, TODAY)
    expect(() => saveInvoice(db, e, TODAY)).toThrow(/already sent/)
  })

  it('validates amounts and targets', () => {
    const inv = convertQuote(db, approvedQuote().id, TODAY)
    expect(() => recordPayment(db, pay({ invoice_id: inv.id, amount_cents: 0 }))).toThrow(/above \$0/)
    expect(() => recordPayment(db, pay({ invoice_id: inv.id, amount_cents: 1.5 }))).toThrow()
    expect(() => recordPayment(db, pay({}))).toThrow(/invoice or a quote/)
  })

  it('overdue is computed from the due date', () => {
    const inv = convertQuote(db, approvedQuote().id, TODAY)
    markInvoiceSent(db, inv.id, TODAY)
    const i = loadInvoice(db, inv.id)
    expect(invoiceDisplayStatus(i, '2026-12-06')).toBe('sent')
    expect(invoiceDisplayStatus(i, '2026-12-07')).toBe('overdue')
    expect(listInvoices(db, { status: 'overdue', today: '2026-12-07' }).map((x) => x.number)).toEqual(['INV-1001'])
    expect(listInvoices(db, { status: 'overdue', today: '2026-12-01' })).toEqual([])
  })

  it('void needs payments removed first, and frees the quote to be invoiced again', () => {
    const q = approvedQuote()
    const inv = convertQuote(db, q.id, TODAY)
    const p = recordPayment(db, pay({ invoice_id: inv.id, amount_cents: 500 }))
    expect(() => voidInvoice(db, inv.id, '')).toThrow(/payments/)
    voidPayment(db, p.id, '')
    expect(voidInvoice(db, inv.id, 'Wrong sizes')).toMatchObject({ status: 'void', balance_cents: 0 })
    expect(convertQuote(db, q.id, TODAY).number).toBe('INV-1002')
  })
})

describe('invoices from scratch and customers', () => {
  it('creates a draft that follows current pricing', () => {
    const inv = createInvoice(db, { customer_id: customerId }, TODAY)
    expect(inv).toMatchObject({ number: 'INV-1001', status: 'draft', due_on: '2026-12-06', pricing_locked: false })
    saveInvoice(db, { ...iEdit(inv), fees: [{ uid: 'f1', fee_preset_id: null, name: 'Art time', kind: 'art', basis: 'per_hour', quantity: 2, amount_cents: 6000, taxable: true }] }, TODAY)
    expect(loadInvoice(db, inv.id).total_cents).toBe(12960)
  })

  it('customer balance counts issued invoices only', () => {
    const inv = convertQuote(db, approvedQuote().id, TODAY)
    expect(listCustomers(db)[0]).toMatchObject({ invoice_count: 1, balance_cents: 0 })
    markInvoiceSent(db, inv.id, TODAY)
    recordPayment(db, pay({ invoice_id: inv.id, amount_cents: 4084 }))
    expect(listCustomers(db)[0].balance_cents).toBe(20000)
    const d = getCustomerDetail(db, customerId)
    expect(d.balance_cents).toBe(20000)
    expect(d.invoices[0]).toMatchObject({ number: 'INV-1001', balance_cents: 20000 })
    expect(d.payments.map((p) => p.amount_cents)).toEqual([4084])
  })
})

describe('invoice and receipt documents', () => {
  it('shows payments, balance due, how to pay, and PAID when settled', async () => {
    const { invoiceDocument, receiptDocument } = await import('../../src/shared/documents')
    saveSettings(db, { ...editableSettings(getSettings(db)), how_to_pay_text: 'Venmo @shop' })
    const inv = convertQuote(db, approvedQuote().id, TODAY)
    markInvoiceSent(db, inv.id, TODAY)
    const p = recordPayment(db, pay({ invoice_id: inv.id, amount_cents: 10000, check_number: '77' }))
    const doc = () => {
      const d = getInvoiceDetail(db, inv.id, TODAY)
      return invoiceDocument({ invoice: d.invoice, customer: d.customer, breakdown: d.breakdown, settings: getSettings(db), logo_url: '', images: [], payments: d.payments, source_quote_number: d.source_quote?.number ?? null })
    }
    const partial = doc()
    expect(partial.title).toBe('Invoice')
    expect(partial.meta.map((m) => m.label)).toEqual(['Invoice date', 'Due date', 'Terms', 'Quote'])
    expect(partial.totals.slice(-2)).toEqual([
      { label: 'Payment Nov 21, 2026 · Check #77', amount: '−$100.00', muted: true },
      { label: 'Balance due', amount: '$140.84', strong: true }
    ])
    expect(partial.callout).toEqual({ label: 'Balance due by Dec 6, 2026', amount: '$140.84' })
    expect(partial.how_to_pay).toBe('Venmo @shop')
    expect(partial.stamp).toBe('')
    expect(JSON.stringify(partial)).not.toMatch(/internal|cost|margin|profit/i)

    recordPayment(db, pay({ invoice_id: inv.id, amount_cents: 14084, method: 'zelle' }))
    const paid = doc()
    expect(paid.stamp).toBe('PAID')
    expect(paid.callout?.label).toBe('Paid in full')
    expect(paid.how_to_pay).toBe('')

    const { customerSummary } = await import('../../src/main/db/repos/docstore')
    const r = receiptDocument({ payment: { ...p, applied_to: 'INV-1001' }, customer: customerSummary(db, customerId), settings: getSettings(db), logo_url: '', applied: { kind: 'invoice', number: 'INV-1001', job_name: 'Staff tees', total_cents: 24084, paid_cents: 24084 } })
    expect(r).toMatchObject({ title: 'Receipt', number: 'R-1001', callout: { label: 'Amount received', amount: '$100.00' } })
    expect(r.receipt?.rows[0]).toEqual({ label: 'Payment for', value: 'Invoice INV-1001 · Staff tees' })
    expect(r.totals.at(-1)).toEqual({ label: 'Balance remaining', amount: '$0.00', strong: true })
  })
})

describe('upgrading a Phase 2 database', () => {
  it('adds invoices and payments without touching existing quotes', async () => {
    const { MIGRATIONS } = await import('../../src/main/db/migrate')
    const old = new Database(':memory:')
    old.pragma('foreign_keys = ON')
    migrate(old, MIGRATIONS.filter((m) => m.version <= 3))
    seedIfEmpty(old)
    const c = saveCustomer(old, customer)
    const q = createQuote(old, { customer_id: c.id }, TODAY)
    migrate(old)
    expect(loadQuote(old, q.id).number).toBe('Q-1001')
    expect(createInvoice(old, { customer_id: c.id }, TODAY).number).toBe('INV-1001')
  })
})
