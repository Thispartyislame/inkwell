import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../../src/main/db/migrate'
import { seedIfEmpty } from '../../src/main/db/seed'
import { saveCustomer } from '../../src/main/db/repos/customers'
import { listGarments } from '../../src/main/db/repos/garments'
import { convertQuote, createInvoice, loadInvoice, markInvoiceSent, saveInvoice, voidInvoice } from '../../src/main/db/repos/invoices'
import { recordPayment } from '../../src/main/db/repos/payments'
import { boardJobs, garmentOrder, setProductionStatus } from '../../src/main/db/repos/production'
import { approveQuote, createQuote, declineQuote, loadQuote, markSent, saveQuote } from '../../src/main/db/repos/quotes'
import { dashboard, paymentsByMethod, periodOf, salesByCustomer, salesByPeriod, salesTax, winRate } from '../../src/main/db/repos/reports'
import { editableSettings, getSettings, saveSettings } from '../../src/main/db/repos/settings'
import { csvCell, csvMoney, toCsv } from '../../src/shared/csv'
import { InvoiceEditSchema, type InvoiceEdit, type PaymentInput } from '../../src/shared/invoice'
import { newImprint, newLine, QuoteEditSchema, type QuoteEdit, type QuoteLine } from '../../src/shared/quote'
import type { CustomerInput } from '../../src/shared/schemas'

let db: Database.Database
let taxable: number
let exempt: number

const cust = (company: string, over: Partial<CustomerInput> = {}): CustomerInput => ({
  company_name: company, first_name: '', last_name: '', email: '', phone: '',
  billing_line1: '', billing_line2: '', billing_city: '', billing_state: '', billing_postal_code: '',
  shipping_same_as_billing: true, shipping_line1: '', shipping_line2: '', shipping_city: '', shipping_state: '', shipping_postal_code: '',
  tax_exempt: false, exempt_cert_number: '', exempt_cert_attachment_id: null, exempt_cert_expires_on: null, pricing_matrix_id: null, notes: '', tags: [], ...over
})

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  seedIfEmpty(db)
  saveSettings(db, { ...editableSettings(getSettings(db)), default_tax_bp: 800 })
  taxable = saveCustomer(db, cust('Riverside Brewing')).id
  exempt = saveCustomer(db, cust('Lincoln School PTO', { tax_exempt: true, exempt_cert_number: 'ST-1' })).id
})

const pick = <T,>(schema: { shape: object }, r: object) => Object.fromEntries(Object.keys(schema.shape).map((k) => [k, (r as Record<string, unknown>)[k]])) as T

function tees(color: string, sizes: Record<string, number>, over: Partial<QuoteLine> = {}): QuoteLine {
  const g = listGarments(db, { search: 'gildan 5000' })[0]
  return newLine({
    garment_id: g.id,
    garment: { brand: g.brand, style_number: g.style_number, name: g.name, category: g.category, supplier: g.supplier, supplier_other: '' },
    costs: { base: g.cost_base_cents, '2xl': g.cost_2xl_cents, '3xl': g.cost_3xl_cents, '4xl_plus': g.cost_4xl_plus_cents },
    color_name: color,
    sizes: Object.entries(sizes).map(([size, qty]) => ({ size, qty })),
    imprints: [newImprint({ colors: 1 })],
    ...over
  })
}

/** Sent invoice: 24 tees ($198.00) + $25 screens = $223.00 net; optional untaxed shipping. */
function invoice(customerId: number, issued: string, shippingCents = 0) {
  const inv = createInvoice(db, { customer_id: customerId }, issued)
  const e = pick<InvoiceEdit>(InvoiceEditSchema, inv)
  saveInvoice(db, { ...e, lines: [tees('White', { M: 24 })], fees: shippingCents ? [{ uid: 's', fee_preset_id: null, name: 'Shipping', kind: 'shipping', basis: 'per_job', quantity: null, amount_cents: shippingCents, taxable: false }] : [] }, issued)
  markInvoiceSent(db, inv.id, issued)
  return loadInvoice(db, inv.id)
}

const pay = (invoice_id: number, amount_cents: number, received_on: string, method: PaymentInput['method'] = 'check'): PaymentInput => ({ invoice_id, quote_id: null, received_on, amount_cents, method, check_number: '', reference: '', note: '', is_deposit: false })

function quote(customerId: number, issued: string, lines: QuoteLine[] = [tees('Black', { M: 12, L: 12 })]) {
  const q = createQuote(db, { customer_id: customerId }, issued)
  saveQuote(db, { ...pick<QuoteEdit>(QuoteEditSchema, q), job_name: `Job ${q.number}`, lines }, issued)
  markSent(db, q.id, issued)
  return loadQuote(db, q.id)
}

describe('sales reports', () => {
  it('sales by month count issued invoices by invoice date and payments by payment date', () => {
    const a = invoice(taxable, '2026-09-10', 1000) // net 22300, tax 1784, ship 1000 → 25084
    invoice(exempt, '2026-10-05') // net 22300, tax 0
    const draft = createInvoice(db, { customer_id: taxable }, '2026-10-06') // drafts don't count
    void draft
    const v = invoice(taxable, '2026-10-07')
    voidInvoice(db, v.id, '') // void doesn't count
    recordPayment(db, pay(a.id, 10000, '2026-10-01'))
    const rows = salesByPeriod(db, '2026-09-01', '2026-11-30')
    expect(rows).toEqual([
      { period: '2026-09', invoices: 1, net_sales_cents: 22300, tax_cents: 1784, shipping_cents: 1000, total_cents: 25084, collected_cents: 0 },
      { period: '2026-10', invoices: 1, net_sales_cents: 22300, tax_cents: 0, shipping_cents: 0, total_cents: 22300, collected_cents: 10000 },
      { period: '2026-11', invoices: 0, net_sales_cents: 0, tax_cents: 0, shipping_cents: 0, total_cents: 0, collected_cents: 0 }
    ])
    expect(salesByPeriod(db, '2026-07-01', '2026-12-31', 'quarter').map((r) => [r.period, r.invoices])).toEqual([
      ['2026-Q3', 1],
      ['2026-Q4', 1]
    ])
  })

  it('sales tax splits taxable, exempt and non-taxable sales', () => {
    invoice(taxable, '2026-10-01', 1000)
    invoice(exempt, '2026-10-02', 500)
    expect(salesTax(db, '2026-10-01', '2026-10-31')).toEqual([
      { period: '2026-10', invoices: 2, gross_sales_cents: 22300 + 1000 + 22300 + 500, taxable_sales_cents: 22300, exempt_sales_cents: 22800, nontaxable_sales_cents: 1000, tax_cents: 1784 }
    ])
  })

  it('sales by customer, payments by method', () => {
    const a = invoice(taxable, '2026-10-01')
    invoice(taxable, '2026-10-02')
    const b = invoice(exempt, '2026-10-03')
    recordPayment(db, pay(a.id, 24084, '2026-10-04', 'zelle'))
    recordPayment(db, pay(b.id, 2300, '2026-10-05', 'zelle'))
    recordPayment(db, pay(b.id, 20000, '2026-10-05', 'cash'))
    expect(salesByCustomer(db, '2026-10-01', '2026-10-31')).toEqual([
      { customer_id: taxable, customer: 'Riverside Brewing', invoices: 2, net_sales_cents: 44600, tax_cents: 3568, total_cents: 48168, paid_cents: 24084, balance_cents: 24084 },
      { customer_id: exempt, customer: 'Lincoln School PTO', invoices: 1, net_sales_cents: 22300, tax_cents: 0, total_cents: 22300, paid_cents: 22300, balance_cents: 0 }
    ])
    expect(paymentsByMethod(db, '2026-10-01', '2026-10-31')).toEqual([
      { method: 'cash', label: 'Cash', payments: 1, amount_cents: 20000 },
      { method: 'zelle', label: 'Zelle', payments: 2, amount_cents: 26384 }
    ])
  })

  it('win rate counts decided quotes, with sent quotes past expiry as expired', () => {
    const won = quote(taxable, '2026-10-01')
    approveQuote(db, won.id, '', '2026-10-02')
    const lost = quote(taxable, '2026-10-01')
    declineQuote(db, lost.id, 'Price')
    quote(taxable, '2026-10-01') // expires 2026-10-31
    quote(taxable, '2026-10-20') // still open
    const r = winRate(db, '2026-10-01', '2026-10-31', '2026-11-05')
    expect(r).toMatchObject({ quotes: 4, approved: 1, declined: 1, expired: 1, open: 1, win_rate_bp: 3333 })
    expect(r.approved_cents).toBe(won.total_cents)
  })

  it('periods', () => {
    expect(periodOf('2026-11-21', 'month')).toBe('2026-11')
    expect(periodOf('2026-11-21', 'quarter')).toBe('2026-Q4')
  })
})

describe('dashboard', () => {
  it('summarizes quotes awaiting response, balances, sales and in-hands dates', () => {
    const today = '2026-11-21'
    const q1 = quote(taxable, '2026-10-25') // expires 11-24: expiring this week
    quote(taxable, '2026-11-15') // expires 12-15
    const inv = invoice(taxable, '2026-10-20') // due on receipt → overdue
    recordPayment(db, pay(inv.id, 4084, '2026-11-02'))
    invoice(exempt, '2026-11-10')
    const d = dashboard(db, today)
    expect(d.awaiting.count).toBe(2)
    expect(d.expiring.items.map((x) => x.number)).toEqual([q1.number])
    expect(d.outstanding).toMatchObject({ count: 2, total_cents: 20000 + 22300 })
    expect(d.overdue.items.map((x) => x.number)).toEqual(['INV-1001', 'INV-1002'])
    expect(d.sales).toEqual({ this_month_cents: 22300, last_month_cents: 22300, collected_this_month_cents: 4084, collected_last_month_cents: 0 })
  })
})

describe('production', () => {
  it('approved quotes start on the board and carry their stage to the invoice', () => {
    const q = quote(taxable, '2026-11-01')
    expect(boardJobs(db)).toEqual([])
    approveQuote(db, q.id, '', '2026-11-02')
    expect(boardJobs(db).map((j) => [j.kind, j.number, j.status, j.pieces])).toEqual([['quote', q.number, 'awaiting_art', 24]])
    setProductionStatus(db, { kind: 'quote', id: q.id }, 'proof_approved')
    const inv = convertQuote(db, q.id, '2026-11-03')
    expect(boardJobs(db).map((j) => [j.kind, j.number, j.status])).toEqual([['invoice', inv.number, 'proof_approved']])
    expect(() => setProductionStatus(db, { kind: 'invoice', id: inv.id }, 'nope' as never)).toThrow(/Unknown/)
  })

  it('in-hands dates show on the dashboard until the job is done', () => {
    const q = createQuote(db, { customer_id: taxable }, '2026-11-01')
    saveQuote(db, { ...pick<QuoteEdit>(QuoteEditSchema, q), in_hands_on: '2026-11-28', lines: [tees('Black', { M: 24 })] }, '2026-11-01')
    approveQuote(db, q.id, '', '2026-11-02')
    expect(dashboard(db, '2026-11-21').in_hands.map((j) => [j.number, j.in_hands_on])).toEqual([[q.number, '2026-11-28']])
    setProductionStatus(db, { kind: 'quote', id: q.id }, 'done')
    expect(dashboard(db, '2026-11-21').in_hands).toEqual([])
  })

  it('combines blank garments across jobs by supplier, style, color and size', () => {
    const a = quote(taxable, '2026-11-01', [tees('Black', { M: 12, L: 10, '2XL': 2 }), tees('White', { S: 5 })])
    const b = quote(exempt, '2026-11-01', [tees('Black', { M: 3, XL: 4 }), tees('Navy', { M: 10 }, { customer_supplied: true })])
    const o = garmentOrder(db, [
      { kind: 'quote', id: a.id },
      { kind: 'quote', id: b.id }
    ])
    expect(o.size_columns).toEqual(['S', 'M', 'L', 'XL', '2XL'])
    expect(o.groups).toHaveLength(1)
    expect(o.groups[0].supplier).toBe('S&S Activewear')
    expect(o.groups[0].items.map((i) => [i.color, i.sizes, i.total])).toEqual([
      ['Black', { M: 15, L: 10, XL: 4, '2XL': 2 }, 31],
      ['White', { S: 5 }, 5]
    ])
    expect(o.total).toBe(36)
    expect(o.est_cost_cents).toBe(29 * 250 + 2 * 425 + 5 * 250)
    expect(o.skipped_customer_supplied).toBe(1)
    expect(o.jobs.map((j) => j.customer)).toEqual(['Riverside Brewing', 'Lincoln School PTO'])
  })
})

describe('csv', () => {
  it('quotes when needed', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell(null)).toBe('')
    expect(csvMoney(123456)).toBe('1234.56')
    expect(csvMoney(-5)).toBe('-0.05')
    expect(toCsv(['A', 'B'], [[1, 'x,y']])).toBe('A,B\r\n1,"x,y"\r\n')
  })
})
