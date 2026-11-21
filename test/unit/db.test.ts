import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, MIGRATIONS, schemaVersion } from '../../src/main/db/migrate'
import { seedIfEmpty } from '../../src/main/db/seed'
import { allocateNumber, completeSetup, editableSettings, getSettings, saveSettings } from '../../src/main/db/repos/settings'
import { deleteContact, getCustomerDetail, listCustomers, listTags, saveContact, saveCustomer, setCustomerArchived } from '../../src/main/db/repos/customers'
import { duplicateGarment, importGarments, listGarments, saveGarment, setGarmentArchived } from '../../src/main/db/repos/garments'
import { duplicateMatrix, getRules, listFees, listInks, listMatrices, saveMatrix, saveRules } from '../../src/main/db/repos/pricing'
import { globalSearch } from '../../src/main/db/repos/search'
import type { CustomerInput, GarmentInput } from '../../src/shared/schemas'

let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  seedIfEmpty(db)
})

const customer = (over: Partial<CustomerInput> = {}): CustomerInput => ({
  company_name: 'Riverside Brewing',
  first_name: 'Dana',
  last_name: 'Ortiz',
  email: 'dana@example.com',
  phone: '555-0100',
  billing_line1: '1 Main St',
  billing_line2: '',
  billing_city: 'Springfield',
  billing_state: 'NY',
  billing_postal_code: '13201',
  shipping_same_as_billing: true,
  shipping_line1: '',
  shipping_line2: '',
  shipping_city: '',
  shipping_state: '',
  shipping_postal_code: '',
  tax_exempt: false,
  exempt_cert_number: '',
  exempt_cert_attachment_id: null,
  exempt_cert_expires_on: null,
  pricing_matrix_id: null,
  notes: '',
  tags: [],
  ...over
})

const garment = (over: Partial<GarmentInput> = {}): GarmentInput => ({
  brand: 'Comfort Colors',
  style_number: '1717',
  name: 'Garment-Dyed Tee',
  category: 'tee',
  supplier: 'sanmar',
  supplier_other: '',
  colors: [{ name: 'Pepper', hex: '#5f605b', is_dark: true }],
  sizes: ['S', 'M', 'L'],
  cost_base_cents: 500,
  cost_2xl_cents: 700,
  cost_3xl_cents: 800,
  cost_4xl_plus_cents: 900,
  notes: '',
  active: true,
  ...over
})

describe('migrations and seed', () => {
  it('migrates a fresh database to the latest version', () => {
    expect(schemaVersion(db)).toBe(MIGRATIONS[MIGRATIONS.length - 1].version)
  })
  it('is idempotent', () => {
    expect(migrate(db)).toEqual([])
    expect(seedIfEmpty(db)).toBe(false)
  })
  it('seeds labeled sample pricing', () => {
    const matrices = listMatrices(db)
    expect(matrices.length).toBeGreaterThanOrEqual(3)
    expect(matrices.every((m) => m.is_sample)).toBe(true)
    expect(getRules(db).is_sample).toBe(true)
    expect(listFees(db).map((f) => f.name)).toContain('Screen Setup')
    expect(listInks(db).length).toBeGreaterThan(0)
  })
})

describe('settings and numbering', () => {
  it('allocates sequential numbers and never reuses them', () => {
    const a = db.transaction(() => allocateNumber(db, 'quote'))()
    const b = db.transaction(() => allocateNumber(db, 'quote'))()
    expect([a.number, b.number]).toEqual(['Q-1001', 'Q-1002'])
    expect(db.transaction(() => allocateNumber(db, 'invoice'))().number).toBe('INV-1001')
  })
  it('refuses to run outside a transaction', () => {
    expect(() => allocateNumber(db, 'quote')).toThrow(/transaction/)
  })
  it('rolls the counter back with a failed transaction (number was never issued)', () => {
    expect(() =>
      db.transaction(() => {
        allocateNumber(db, 'quote')
        throw new Error('boom')
      })()
    ).toThrow('boom')
    expect(db.transaction(() => allocateNumber(db, 'quote'))().number).toBe('Q-1001')
  })
  it('will not let the next number go back to a used one', () => {
    db.transaction(() => allocateNumber(db, 'quote'))()
    const s = editableSettings(getSettings(db))
    expect(() => saveSettings(db, { ...s, quote_next_number: 1001 })).toThrow(/higher than 1001/)
    expect(saveSettings(db, { ...s, quote_next_number: 2000 }).quote_next_number).toBe(2000)
    expect(db.transaction(() => allocateNumber(db, 'quote'))().number).toBe('Q-2000')
  })
  it('validates fields', () => {
    const s = editableSettings(getSettings(db))
    expect(() => saveSettings(db, { ...s, email: 'nope' })).toThrow(/valid email/)
    expect(() => saveSettings(db, { ...s, default_tax_bp: -1 })).toThrow()
  })
  it('completes setup', () => {
    const s = completeSetup(db, {
      shop_name: 'Ink & Thread',
      address_line1: '',
      address_line2: '',
      city: '',
      state: '',
      postal_code: '',
      phone: '',
      email: 'shop@example.com',
      website: '',
      default_tax_bp: 800,
      quote_prefix: 'QT',
      quote_next_number: 500,
      invoice_prefix: 'IN',
      invoice_next_number: 700,
      payment_terms: 'net_15',
      payment_terms_days: 15,
      default_deposit_bp: 5000,
      quote_expiration_days: 14,
      terms_text: 'Terms'
    })
    expect(s.setup_completed_at).toBeTruthy()
    expect(s.shop_name).toBe('Ink & Thread')
    expect(db.transaction(() => allocateNumber(db, 'quote'))().number).toBe('QT500')
  })
})

describe('customers', () => {
  it('creates, searches, edits and archives', () => {
    const c = saveCustomer(db, customer({ tags: ['brewery', 'brewery', ' local '] }))
    expect(c.tags).toEqual(['brewery', 'local'])
    saveCustomer(db, customer({ company_name: '', first_name: 'Sam', last_name: 'Lee', email: 'sam@example.com', tags: ['school'] }))
    expect(listCustomers(db, { search: 'dana ortiz' }).map((r) => r.display_name)).toEqual(['Riverside Brewing'])
    expect(listCustomers(db, { search: 'sam' }).map((r) => r.display_name)).toEqual(['Sam Lee'])
    expect(listCustomers(db, { tag: 'school' })).toHaveLength(1)
    expect(listTags(db)).toEqual(['brewery', 'local', 'school'])

    saveCustomer(db, { ...customer(), id: c.id, tags: c.tags, phone: '555-0199' })
    const detail = getCustomerDetail(db, c.id)
    expect(detail.activity.map((a) => a.action)).toEqual(['edited', 'created'])
    expect(detail.activity[0].details).toEqual({ fields: ['phone'] })

    setCustomerArchived(db, c.id, true)
    expect(listCustomers(db)).toHaveLength(1)
    expect(listCustomers(db, { includeArchived: true })).toHaveLength(2)
    setCustomerArchived(db, c.id, false)
    expect(listCustomers(db)).toHaveLength(2)
  })
  it('treats LIKE wildcards in search literally', () => {
    saveCustomer(db, customer())
    expect(listCustomers(db, { search: '%' })).toHaveLength(0)
  })
  it('requires a name and a valid email', () => {
    expect(() => saveCustomer(db, customer({ company_name: '', first_name: '', last_name: '' }))).toThrow(/company or a contact/)
    expect(() => saveCustomer(db, customer({ email: 'bad' }))).toThrow(/valid email/)
  })
  it('manages contacts', () => {
    const c = saveCustomer(db, customer())
    const k = saveContact(db, { customer_id: c.id, name: 'Pat', email: '', phone: '', role: 'Buyer' })
    saveContact(db, { ...k, role: 'Owner' })
    expect(getCustomerDetail(db, c.id).contacts.map((x) => x.role)).toEqual(['Owner'])
    deleteContact(db, k.id)
    expect(getCustomerDetail(db, c.id).contacts).toEqual([])
  })
})

describe('garments', () => {
  it('rejects a duplicate brand + style', () => {
    saveGarment(db, garment())
    expect(() => saveGarment(db, garment({ name: 'Other' }))).toThrow(/already in the catalog/)
  })
  it('duplicates with a distinct style number', () => {
    const g = saveGarment(db, garment())
    const d1 = duplicateGarment(db, g.id)
    const d2 = duplicateGarment(db, g.id)
    expect([d1.style_number, d2.style_number]).toEqual(['1717 copy', '1717 copy 2'])
    expect(d1.colors).toEqual(g.colors)
  })
  it('searches by every word', () => {
    expect(listGarments(db, { search: 'gildan hood' }).map((g) => g.style_number)).toEqual(['18500'])
    expect(listGarments(db, { search: 'sport grey 5000' }).map((g) => g.style_number)).toEqual(['5000'])
  })
  it('archives and restores', () => {
    const g = saveGarment(db, garment())
    setGarmentArchived(db, g.id, true)
    expect(listGarments(db, { search: '1717' })).toHaveLength(0)
    // archived style no longer blocks a new one with the same style
    const again = saveGarment(db, garment())
    expect(() => setGarmentArchived(db, g.id, false)).toThrow(/already in the catalog/)
    expect(again.id).not.toBe(g.id)
  })
  it('imports with merge and skip', () => {
    saveGarment(db, garment())
    const rows = [garment({ colors: [{ name: 'Pepper', hex: '#5f605b', is_dark: true }, { name: 'Ivory', hex: '#f8f3e3', is_dark: false }], sizes: ['XL'], cost_base_cents: 550, cost_2xl_cents: 0 }), garment({ style_number: '1566', name: 'Crewneck', category: 'crewneck' })]
    expect(importGarments(db, rows, 'skip')).toEqual({ created: 1, updated: 0, skipped: 1 })
    expect(importGarments(db, rows, 'merge')).toEqual({ created: 0, updated: 2, skipped: 0 })
    const merged = listGarments(db, { search: '1717' })[0]
    expect(merged.colors.map((c) => c.name)).toEqual(['Pepper', 'Ivory'])
    expect(merged.sizes).toEqual(['S', 'M', 'L', 'XL'])
    expect(merged.cost_base_cents).toBe(550)
    expect(merged.cost_2xl_cents).toBe(700) // zero in file keeps existing cost
  })
  it('import is all or nothing', () => {
    const before = listGarments(db).length
    expect(() => importGarments(db, [garment({ style_number: 'A1' }), garment({ style_number: 'A2', name: '' })], 'merge')).toThrow(/Garment 2/)
    expect(listGarments(db).length).toBe(before)
  })
})

describe('pricing setup', () => {
  it('validates matrix shape and ordering', () => {
    const m = listMatrices(db)[0]
    expect(() => saveMatrix(db, { ...m, breaks: [24, 12, ...m.breaks.slice(2)] })).toThrow(/increase/)
    expect(() => saveMatrix(db, { ...m, prices: m.prices.slice(1) })).toThrow(/grid/)
  })
  it('editing a sample clears the sample flag; one default per method', () => {
    const m = listMatrices(db).find((x) => x.method === 'screen' && x.is_default)!
    const copy = duplicateMatrix(db, m.id)
    expect(copy.is_default).toBe(false)
    expect(copy.is_sample).toBe(false)
    saveMatrix(db, { ...copy, is_default: true })
    const screens = listMatrices(db).filter((x) => x.method === 'screen' && x.is_default)
    expect(screens.map((x) => x.id)).toEqual([copy.id])
  })
  it('validates markup tiers', () => {
    const r = getRules(db)
    expect(() => saveRules(db, { ...r, markup_tiers: [{ up_to_cents: 500, value: 100 }] })).toThrow(/last tier/)
    const saved = saveRules(db, { ...r, screen_fee_cents: 3000 })
    expect(saved.screen_fee_cents).toBe(3000)
    expect(saved.is_sample).toBe(false)
  })
})

describe('search', () => {
  it('finds customers and garments', () => {
    saveCustomer(db, customer())
    const r = globalSearch(db, 'river')
    expect(r.map((x) => x.kind)).toEqual(['customer'])
    expect(globalSearch(db, 'gildan').every((x) => x.kind === 'garment')).toBe(true)
  })
})
