import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let app: ElectronApplication
let win: Page
let dataDir: string
const errors: string[] = []
const nav = (name: string) => win.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click()
const pdfs = () => (fs.existsSync(path.join(dataDir, 'pdfs')) ? fs.readdirSync(path.join(dataDir, 'pdfs')).sort() : [])

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-e2e4-'))
  app = await electron.launch({ args: [path.join(__dirname, '../..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], env: { ...process.env, INKWELL_USER_DATA: dataDir } })
  win = await app.firstWindow()
  win.on('pageerror', (e) => errors.push(e.message))
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await win.setViewportSize({ width: 1440, height: 900 })
  // Two jobs: an approved quote (Riverside) and an invoiced, partly paid job (Lincoln, exempt).
  await win.evaluate(async () => {
    type R = { ok: boolean; data?: unknown; error?: { message: string } }
    const call = async (d: string, m: string, ...a: unknown[]): Promise<any> => {
      const r: R = await (globalThis as unknown as { rawApi: Record<string, Record<string, (...x: unknown[]) => Promise<R>>> }).rawApi[d][m](...a)
      if (!r.ok) throw new Error(r.error?.message)
      return r.data
    }
    const today = new Date()
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const inDays = (n: number) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n))
    await call('settings', 'completeSetup', { shop_name: 'E2E Print Shop', address_line1: '', address_line2: '', city: '', state: '', postal_code: '', phone: '', email: '', website: '', default_tax_bp: 800, quote_prefix: 'Q-', quote_next_number: 1001, invoice_prefix: 'INV-', invoice_next_number: 1001, payment_terms: 'due_on_receipt', payment_terms_days: 0, default_deposit_bp: 5000, quote_expiration_days: 30, terms_text: '' })
    const base = { first_name: '', last_name: '', email: '', phone: '', billing_line1: '', billing_line2: '', billing_city: '', billing_state: '', billing_postal_code: '', shipping_same_as_billing: true, shipping_line1: '', shipping_line2: '', shipping_city: '', shipping_state: '', shipping_postal_code: '', tax_exempt: false, exempt_cert_number: '', exempt_cert_attachment_id: null, exempt_cert_expires_on: null, pricing_matrix_id: null, notes: '', tags: [] }
    const a = await call('customers', 'save', { ...base, company_name: 'Riverside Brewing' })
    const b = await call('customers', 'save', { ...base, company_name: 'Lincoln School PTO', tax_exempt: true, exempt_cert_number: 'ST-1' })
    const g = (await call('garments', 'list', { search: '5000' }))[0]
    const line = (color: string, sizes: Record<string, number>) => ({ uid: crypto.randomUUID(), garment_id: g.id, garment: { brand: g.brand, style_number: g.style_number, name: g.name, category: g.category, supplier: g.supplier, supplier_other: '' }, costs: { base: g.cost_base_cents, '2xl': g.cost_2xl_cents, '3xl': g.cost_3xl_cents, '4xl_plus': g.cost_4xl_plus_cents }, description: '', customer_supplied: false, color_name: color, color_hex: '#111111', is_dark: false, sizes: Object.entries(sizes).map(([size, qty]) => ({ size, qty })), imprints: [{ uid: crypto.randomUUID(), location: 'front', location_custom: '', method: 'screen', colors: 1, underbase: false, underbase_source: 'auto', specialty: [], print_size: 'standard', stitch_count: 0, new_digitizing: false, transfer_size: 1, is_reorder: false, matrix_id: null, notes: '' }], overrides: {}, override_reason: '' })
    const keys = ['id', 'customer_id', 'contact_id', 'job_name', 'issued_on', 'expires_on', 'in_hands_on', 'customer_notes', 'internal_notes', 'tax_bp_override', 'discount_mode', 'discount_value', 'deposit_bp', 'rush', 'charge_tax_anyway', 'is_reorder', 'disabled_auto_fees']
    const job = async (customer: number, name: string, lines: unknown[], inHands: string) => {
      const q = await call('quotes', 'create', { customer_id: customer })
      await call('quotes', 'save', { ...Object.fromEntries(keys.map((k) => [k, q[k]])), job_name: name, in_hands_on: inHands, lines, fees: [] })
      await call('quotes', 'markSent', q.id)
      await call('quotes', 'approve', q.id, '')
      return q
    }
    await job(a.id, 'Staff tees', [line('Black', { M: 12, L: 12 })], inDays(5))
    const q2 = await job(b.id, 'Field day', [line('Black', { M: 6, XL: 4 }), line('White', { S: 10 })], inDays(2))
    const inv = await call('quotes', 'convert', q2.id)
    await call('invoices', 'markSent', inv.id)
    await call('payments', 'record', { invoice_id: inv.id, quote_id: null, received_on: iso(today), amount_cents: 10000, method: 'cash', check_number: '', reference: '', note: '', is_deposit: false })
    // an open quote awaiting response
    const open = await call('quotes', 'create', { customer_id: a.id })
    await call('quotes', 'save', { ...Object.fromEntries(keys.map((k) => [k, open[k]])), lines: [line('Navy', { M: 24 })], fees: [] })
    await call('quotes', 'markSent', open.id)
  })
  await win.reload()
})

test.afterAll(async () => {
  await app?.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('dashboard', async () => {
  // Lincoln invoice: 20 pcs × (500 + 450) = $190 + $25 screens = $215.00, exempt; $100 paid
  await expect(win.getByRole('link', { name: /Quotes awaiting response 1/ })).toBeVisible()
  await expect(win.getByRole('link', { name: /Outstanding balance \$115\.00/ })).toBeVisible()
  // due on receipt = due today, so not overdue yet
  await expect(win.getByRole('link', { name: /Overdue \$0\.00/ })).toBeVisible()
  await expect(win.getByRole('link', { name: /Sales this month \$215\.00/ })).toBeVisible()
  await expect(win.getByRole('button', { name: /Q-1002 .*Lincoln/ }).or(win.getByRole('button', { name: /INV-1001.*Lincoln/ }))).toBeVisible()
})

test('production board moves a job', async () => {
  await nav('Production')
  const awaiting = win.getByRole('region', { name: 'Awaiting art' })
  await expect(awaiting.getByText('Q-1001')).toBeVisible()
  await expect(awaiting.getByText('INV-1001')).toBeVisible()
  await win.getByLabel('Move Q-1001').selectOption('proof_approved')
  await expect(win.getByRole('region', { name: 'Proof approved' }).getByText('Q-1001')).toBeVisible()
})

test('garment order list combines jobs', async () => {
  await win.getByRole('button', { name: 'Garment order list' }).click()
  await expect(win.getByRole('heading', { name: 'Garment order list' })).toBeVisible()
  // Black: 12 M + 12 L (Q-1001) + 6 M + 4 XL (INV-1001) = 34; White S 10
  await expect(win.getByRole('row', { name: /Gildan 5000.*Black 18 12 4 34/ })).toBeVisible()
  await expect(win.getByRole('row', { name: /White.*10/ })).toBeVisible()
  await expect(win.getByText('44 pieces')).toBeVisible()
  await win.getByRole('button', { name: 'Open PDF' }).click()
  await expect.poll(pdfs, { timeout: 20000 }).toContainEqual(expect.stringMatching(/^Garment_order_/))
  await win.getByRole('button', { name: 'Mark as ordered' }).click()
  await nav('Production')
  await expect(win.getByRole('region', { name: 'Garments ordered' }).getByText('Q-1001')).toBeVisible()
})

test('reports', async () => {
  await nav('Reports')
  await win.getByRole('tab', { name: 'Sales tax' }).click()
  await win.getByLabel('Date range').selectOption('this_month')
  // exempt sale of $215.00, no tax
  await expect(win.getByRole('row', { name: /Total 1 \$215\.00 \$0\.00 \$215\.00 \$0\.00 \$0\.00/ })).toBeVisible()
  await win.getByRole('tab', { name: 'Payments by method' }).click()
  await expect(win.getByRole('row', { name: /Cash 1 \$100\.00/ })).toBeVisible()
  await win.getByRole('tab', { name: 'Quote win rate' }).click()
  await expect(win.getByText('100%')).toBeVisible()
})

test('command palette and Ctrl+P', async () => {
  await win.keyboard.press('Control+K')
  await win.getByRole('textbox', { name: 'Command' }).fill('garment order')
  await win.keyboard.press('Enter')
  await expect(win.getByRole('heading', { name: 'Garment order list' })).toBeVisible()
  await win.keyboard.press('Control+K')
  await win.getByRole('textbox', { name: 'Command' }).fill('INV-1001')
  await expect(win.getByRole('option', { name: /INV-1001/ })).toBeVisible()
  await win.keyboard.press('Enter')
  await expect(win.getByRole('heading', { name: /INV-1001/ })).toBeVisible()
  await win.keyboard.press('Control+P')
  await expect.poll(pdfs, { timeout: 20000 }).toContain('INV-1001_Lincoln_School_PTO.pdf')
  expect(errors).toEqual([])
})
