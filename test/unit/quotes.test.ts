import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../../src/main/db/migrate'
import { seedIfEmpty } from '../../src/main/db/seed'
import { getCustomerDetail, listCustomers, saveCustomer } from '../../src/main/db/repos/customers'
import { listGarments } from '../../src/main/db/repos/garments'
import { getRules, saveRules } from '../../src/main/db/repos/pricing'
import {
  approveQuote,
  createQuote,
  declineQuote,
  duplicateQuote,
  expireQuotes,
  getQuoteDetail,
  getQuoteTotals,
  listQuotes,
  loadQuote,
  markSent,
  reviseQuote,
  saveQuote,
  setQuoteArchived
} from '../../src/main/db/repos/quotes'
import { globalSearch } from '../../src/main/db/repos/search'
import { newImprint, newLine, type QuoteEdit, type QuoteRecord } from '../../src/shared/quote'
import type { CustomerInput } from '../../src/shared/schemas'

const TODAY = '2026-11-21'
let db: Database.Database
let customerId: number

const customer = (over: Partial<CustomerInput> = {}): CustomerInput => ({
  company_name: 'Riverside Brewing', first_name: 'Dana', last_name: 'Ortiz', email: 'dana@example.com', phone: '',
  billing_line1: '1 Main St', billing_line2: '', billing_city: 'Syracuse', billing_state: 'NY', billing_postal_code: '13201',
  shipping_same_as_billing: true, shipping_line1: '', shipping_line2: '', shipping_city: '', shipping_state: '', shipping_postal_code: '',
  tax_exempt: false, exempt_cert_number: '', exempt_cert_attachment_id: null, exempt_cert_expires_on: null, pricing_matrix_id: null, notes: '', tags: [],
  ...over
})

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  seedIfEmpty(db)
  customerId = saveCustomer(db, customer()).id
})

const edit = (q: QuoteRecord): QuoteEdit => {
  const { number: _n, root_number: _r, revision: _v, previous_revision_id: _p, reorder_of_id: _o, status: _s, sent_at: _sa, approved_at: _aa, approved_by_name: _ab, declined_at: _d, converted_invoice_id: _c, total_cents: _t, created_at: _ca, updated_at: _ua, archived_at: _ar, ...e } = q
  return e
}

/** 24 Gildan 5000 black (sample: cost $2.50 → $5.00) with a 1-color front (sample: 24+ → $3.25) */
function filledQuote(): QuoteRecord {
  const q = createQuote(db, { customer_id: customerId }, TODAY)
  const g = listGarments(db, { search: 'gildan 5000' })[0]
  const line = newLine({
    garment_id: g.id,
    garment: { brand: g.brand, style_number: g.style_number, name: g.name, category: g.category, supplier: g.supplier, supplier_other: '' },
    costs: { base: g.cost_base_cents, '2xl': g.cost_2xl_cents, '3xl': g.cost_3xl_cents, '4xl_plus': g.cost_4xl_plus_cents },
    color_name: 'Black',
    color_hex: '#111111',
    is_dark: true,
    sizes: [
      { size: 'M', qty: 12 },
      { size: 'L', qty: 12 }
    ],
    imprints: [newImprint({ colors: 1 })]
  })
  saveQuote(db, { ...edit(q), job_name: 'Staff tees', lines: [line] }, TODAY)
  return loadQuote(db, q.id)
}

describe('creating and saving', () => {
  it('creates a numbered draft with defaults', () => {
    const q = createQuote(db, {}, TODAY)
    expect(q).toMatchObject({ number: 'Q-1001', root_number: 'Q-1001', revision: 1, status: 'draft', issued_on: TODAY, expires_on: '2026-12-21', deposit_bp: 5000, customer_id: null })
    expect(createQuote(db, {}, TODAY).number).toBe('Q-1002')
  })

  it('round-trips the whole document and stores totals', () => {
    const q = filledQuote()
    expect(q.lines).toHaveLength(1)
    expect(q.lines[0].sizes).toEqual([
      { size: 'M', qty: 12 },
      { size: 'L', qty: 12 }
    ])
    expect(q.lines[0].imprints[0]).toMatchObject({ method: 'screen', colors: 1, underbase: false })
    // unit = 500 garment + 325 print; 24 × 825 = 19800; screens 1 × 2500; subtotal 22300; tax 0%
    const t = getQuoteTotals(db, q.id)
    expect(t.items_subtotal_cents).toBe(19800)
    expect(t.subtotal_cents).toBe(22300)
    expect(q.total_cents).toBe(22300)
    expect(t.deposit_cents).toBe(11150)
    const detail = getQuoteDetail(db, q.id, TODAY)
    expect(detail.breakdown.total_cents).toBe(22300)
    expect(detail.customer?.display_name).toBe('Riverside Brewing')
  })

  it('validates quantities', () => {
    const q = filledQuote()
    const bad = edit(q)
    bad.lines[0].sizes[0].qty = 1.5
    expect(() => saveQuote(db, bad, TODAY)).toThrow(/whole numbers/)
    bad.lines[0].sizes[0].qty = -1
    expect(() => saveQuote(db, bad, TODAY)).toThrow(/negative/)
  })

  it('rejects a contact from another customer', () => {
    const other = saveCustomer(db, customer({ company_name: 'Other' }))
    const k = db.prepare("INSERT INTO customer_contacts (customer_id, name, created_at, updated_at) VALUES (?, 'X', 'n', 'n')").run(other.id)
    const q = createQuote(db, { customer_id: customerId }, TODAY)
    expect(() => saveQuote(db, { ...edit(q), contact_id: Number(k.lastInsertRowid) }, TODAY)).toThrow(/different customer/)
  })
})

describe('statuses', () => {
  it('needs a customer and quantities to send', () => {
    const q = createQuote(db, {}, TODAY)
    expect(() => markSent(db, q.id, TODAY)).toThrow(/customer/)
    saveQuote(db, { ...edit(q), customer_id: customerId }, TODAY)
    expect(() => markSent(db, q.id, TODAY)).toThrow(/quantities/)
  })

  it('freezes prices once sent; drafts follow the current rules', () => {
    const sent = filledQuote()
    const draft = filledQuote()
    markSent(db, sent.id, TODAY)
    saveRules(db, { ...getRules(db), screen_fee_cents: 5000 })
    expect(getQuoteDetail(db, sent.id, TODAY).breakdown.total_cents).toBe(22300)
    expect(getQuoteDetail(db, draft.id, TODAY).breakdown.total_cents).toBe(19800 + 5000)
  })

  it('locks non-drafts', () => {
    const q = filledQuote()
    markSent(db, q.id, TODAY)
    expect(() => saveQuote(db, edit(loadQuote(db, q.id)), TODAY)).toThrow(/Revise/)
  })

  it('approves and declines', () => {
    const a = filledQuote()
    markSent(db, a.id, TODAY)
    expect(approveQuote(db, a.id, 'Dana Ortiz', TODAY)).toMatchObject({ status: 'approved', approved_by_name: 'Dana Ortiz' })
    expect(() => declineQuote(db, a.id, '')).toThrow(/can’t be declined/)
    const d = filledQuote()
    markSent(db, d.id, TODAY)
    expect(declineQuote(db, d.id, 'Went elsewhere').status).toBe('declined')
    expect(getQuoteDetail(db, d.id, TODAY).activity[0]).toMatchObject({ action: 'declined', details: { reason: 'Went elsewhere' } })
  })

  it('expires sent quotes past their date', () => {
    const q = filledQuote()
    markSent(db, q.id, TODAY)
    expect(expireQuotes(db, '2026-12-21')).toBe(0) // valid through the expiration date
    expect(expireQuotes(db, '2026-12-22')).toBe(1)
    expect(loadQuote(db, q.id).status).toBe('expired')
    // an expired quote can still be approved if the customer says yes late
    expect(approveQuote(db, q.id, '', '2026-12-22').status).toBe('approved')
  })
})

describe('revisions, duplicates and reorders', () => {
  it('revise creates -R2 with the same content and keeps history', () => {
    const q = filledQuote()
    markSent(db, q.id, TODAY)
    const r2 = reviseQuote(db, q.id, '2026-11-25')
    expect(r2).toMatchObject({ number: 'Q-1001-R2', revision: 2, status: 'draft', previous_revision_id: q.id, issued_on: '2026-11-25' })
    expect(r2.lines).toEqual(loadQuote(db, q.id).lines)
    expect(loadQuote(db, q.id).status).toBe('superseded')
    expect(() => reviseQuote(db, q.id, TODAY)).toThrow(/already replaced/)
    markSent(db, r2.id, TODAY)
    expect(reviseQuote(db, r2.id, TODAY).number).toBe('Q-1001-R3')
    expect(getQuoteDetail(db, r2.id, TODAY).revisions.map((r) => r.number)).toEqual(['Q-1001', 'Q-1001-R2', 'Q-1001-R3'])
    // revisions don't use up quote numbers
    expect(createQuote(db, {}, TODAY).number).toBe('Q-1002')
    // the list shows only the latest revision
    expect(listQuotes(db).map((x) => x.number)).toEqual(['Q-1002', 'Q-1001-R3'])
  })

  it('duplicate makes a new draft with a new number', () => {
    const q = filledQuote()
    markSent(db, q.id, TODAY)
    const d = duplicateQuote(db, q.id, TODAY)
    expect(d).toMatchObject({ number: 'Q-1002', status: 'draft', job_name: 'Staff tees', reorder_of_id: null })
    expect(d.lines[0].sizes).toEqual(q.lines[0].sizes)
  })

  it('reorder flags screens as reused so screen fees are discounted', () => {
    const q = filledQuote()
    const r = duplicateQuote(db, q.id, TODAY, true)
    expect(r.is_reorder).toBe(true)
    expect(r.reorder_of_id).toBe(q.id)
    expect(r.lines[0].imprints[0].is_reorder).toBe(true)
    // sample reorder discount is 50%: 1 screen × $12.50
    expect(getQuoteDetail(db, r.id, TODAY).breakdown.fees.find((f) => f.key === 'auto:screens')?.amount_cents).toBe(1250)
  })

  it('archived quotes keep their number', () => {
    const q = createQuote(db, {}, TODAY)
    setQuoteArchived(db, q.id, true)
    expect(listQuotes(db)).toEqual([])
    expect(listQuotes(db, { includeArchived: true })).toHaveLength(1)
    expect(createQuote(db, {}, TODAY).number).toBe('Q-1002')
  })
})

describe('lists, customers and search', () => {
  it('filters and searches', () => {
    const q = filledQuote()
    createQuote(db, {}, TODAY)
    markSent(db, q.id, TODAY)
    expect(listQuotes(db, { status: 'sent' }).map((x) => x.number)).toEqual(['Q-1001'])
    expect(listQuotes(db, { search: 'staff' }).map((x) => x.customer_name)).toEqual(['Riverside Brewing'])
    expect(listQuotes(db, { customer_id: customerId })).toHaveLength(1)
    expect(listQuotes(db, { from: '2026-12-01' })).toHaveLength(0)
    expect(globalSearch(db, 'Q-1001')[0]).toMatchObject({ kind: 'quote', id: q.id })
  })

  it('shows quotes on the customer', () => {
    filledQuote()
    expect(listCustomers(db)[0].quote_count).toBe(1)
    expect(getCustomerDetail(db, customerId).quotes[0]).toMatchObject({ number: 'Q-1001', total_cents: 22300 })
  })
})

describe('customer document', () => {
  it('shows prices and never internal data', async () => {
    const { quoteDocument } = await import('../../src/shared/documents')
    const { getSettings } = await import('../../src/main/db/repos/settings')
    const q = filledQuote()
    saveQuote(db, { ...edit(q), internal_notes: 'SECRET: customer haggles, cost is low', customer_notes: 'Thanks Dana!', discount_mode: 'percent', discount_value: 1000 }, TODAY)
    const d = getQuoteDetail(db, q.id, TODAY)
    const doc = quoteDocument({ quote: d.quote, customer: d.customer, breakdown: d.breakdown, settings: getSettings(db), logo_url: '', images: [] })
    const json = JSON.stringify(doc)
    expect(json).not.toMatch(/SECRET|cost|margin|profit|markup/i)
    expect(doc.lines[0]).toMatchObject({ title: 'Gildan 5000 – Heavy Cotton T-Shirt', color: 'Black', sizes: 'M:12  L:12', imprints: ['Front – 1 color'], unit_prices: ['$8.25'], qty: 24, total: '$198.00' })
    expect(doc.fees).toEqual([{ name: 'Screens / setup (1 screen)', detail: '', amount: '$25.00' }])
    expect(doc.totals.map((t) => t.label)).toEqual(['Subtotal', 'Discount (10%)', 'Total'])
    expect(doc.notes).toBe('Thanks Dana!')
    expect(doc.bill_to[0]).toBe('Riverside Brewing')
    expect(doc.callout?.label).toBe('Deposit to start (50%)')
    expect(doc.stamp).toBe('')
  })
})
