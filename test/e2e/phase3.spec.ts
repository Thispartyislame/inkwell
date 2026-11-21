import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { SMTPServer } from 'smtp-server'

let app: ElectronApplication
let win: Page
let dataDir: string
let smtp: SMTPServer
let smtpPort = 0
const received: { to: string[]; raw: string }[] = []
const errors: string[] = []
const nav = (name: string) => win.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click()
type Call = (d: string, m: string, ...a: unknown[]) => Promise<unknown>
const pdfs = () => (fs.existsSync(path.join(dataDir, 'pdfs')) ? fs.readdirSync(path.join(dataDir, 'pdfs')).sort() : [])

test.beforeAll(async () => {
  // A local mail server to receive what the app sends.
  smtp = new SMTPServer({
    authOptional: false,
    disabledCommands: ['STARTTLS'],
    onAuth: (_auth, _session, cb) => cb(null, { user: 'shop' }),
    onData(stream, session, cb) {
      let raw = ''
      stream.on('data', (c) => (raw += c))
      stream.on('end', () => {
        received.push({ to: session.envelope.rcptTo.map((r) => r.address), raw })
        cb()
      })
    }
  })
  await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', () => r()))
  smtpPort = (smtp.server.address() as AddressInfo).port

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-e2e3-'))
  app = await electron.launch({ args: [path.join(__dirname, '../..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], env: { ...process.env, INKWELL_USER_DATA: dataDir } })
  win = await app.firstWindow()
  win.on('pageerror', (e) => errors.push(e.message))
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.evaluate(async () => {
    const call: Call = async (d, m, ...a) => {
      const r = await (globalThis as unknown as { rawApi: Record<string, Record<string, (...x: unknown[]) => Promise<{ ok: boolean; data?: unknown; error?: { message: string } }>>> }).rawApi[d][m](...a)
      if (!r.ok) throw new Error(r.error?.message)
      return r.data
    }
    await call('settings', 'completeSetup', { shop_name: 'E2E Print Shop', address_line1: '', address_line2: '', city: '', state: '', postal_code: '', phone: '', email: 'shop@example.com', website: '', default_tax_bp: 800, quote_prefix: 'Q-', quote_next_number: 1001, invoice_prefix: 'INV-', invoice_next_number: 1001, payment_terms: 'net_15', payment_terms_days: 15, default_deposit_bp: 5000, quote_expiration_days: 30, terms_text: '' })
    const c = (await call('customers', 'save', { company_name: 'Riverside Brewing', first_name: 'Dana', last_name: 'Ortiz', email: 'dana@example.com', phone: '', billing_line1: '', billing_line2: '', billing_city: '', billing_state: '', billing_postal_code: '', shipping_same_as_billing: true, shipping_line1: '', shipping_line2: '', shipping_city: '', shipping_state: '', shipping_postal_code: '', tax_exempt: false, exempt_cert_number: '', exempt_cert_attachment_id: null, exempt_cert_expires_on: null, pricing_matrix_id: null, notes: '', tags: [] })) as { id: number }
    const q = (await call('quotes', 'create', { customer_id: c.id })) as Record<string, unknown>
    const g = ((await call('garments', 'list', { search: '5000' })) as Array<Record<string, number & string>>)[0]
    const line = { uid: 'l1', garment_id: g.id, garment: { brand: g.brand, style_number: g.style_number, name: g.name, category: g.category, supplier: g.supplier, supplier_other: '' }, costs: { base: g.cost_base_cents, '2xl': g.cost_2xl_cents, '3xl': g.cost_3xl_cents, '4xl_plus': g.cost_4xl_plus_cents }, description: '', customer_supplied: false, color_name: 'White', color_hex: '#ffffff', is_dark: false, sizes: [{ size: 'M', qty: 24 }], imprints: [{ uid: 'i1', location: 'front', location_custom: '', method: 'screen', colors: 1, underbase: false, underbase_source: 'auto', specialty: [], print_size: 'standard', stitch_count: 0, new_digitizing: false, transfer_size: 1, is_reorder: false, matrix_id: null, notes: '' }], overrides: {}, override_reason: '' }
    const keys = ['id', 'customer_id', 'contact_id', 'job_name', 'issued_on', 'expires_on', 'in_hands_on', 'customer_notes', 'internal_notes', 'tax_bp_override', 'discount_mode', 'discount_value', 'deposit_bp', 'rush', 'charge_tax_anyway', 'is_reorder', 'disabled_auto_fees']
    const edit = Object.fromEntries(keys.map((k) => [k, q[k]]))
    // 24 × $8.25 + $25 screens = $223.00 + 8% = $240.84
    await call('quotes', 'save', { ...edit, job_name: 'Staff tees', lines: [line], fees: [] })
    await call('quotes', 'markSent', q.id)
  })
  await win.reload()
})

test.afterAll(async () => {
  await app?.close()
  smtp?.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('deposit on the approved quote, then convert', async () => {
  await nav('Quotes')
  await win.getByRole('row', { name: /Q-1001/ }).click()
  await win.getByRole('button', { name: 'Approve' }).first().click()
  await win.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(win.getByRole('heading', { name: 'Q-1001 Approved' })).toBeVisible()

  await win.getByRole('button', { name: 'Record deposit' }).click()
  const dlg = win.getByRole('dialog')
  await expect(dlg.getByLabel('Amount')).toHaveValue('120.42') // 50% deposit
  await dlg.getByLabel('Method').selectOption('venmo')
  await dlg.getByRole('button', { name: /Record \$120\.42/ }).click()
  await expect(win.getByText(/R-1001/).first()).toBeVisible()

  await win.getByRole('button', { name: 'Convert to invoice' }).click()
  await expect(win.getByRole('heading', { name: /INV-1001/ })).toBeVisible()
  await expect(win.getByRole('heading', { name: 'INV-1001 Partially paid' })).toBeVisible()
  await expect(win.getByText(/Priced exactly as approved on quote Q-1001/)).toBeVisible()
  await expect(win.getByText('Balance due').first()).toBeVisible()
  await expect(win.getByText('$120.42').first()).toBeVisible()
})

test('email without SMTP saves the PDF and copies the message', async () => {
  await win.getByRole('button', { name: 'Email', exact: true }).click()
  const dlg = win.getByRole('dialog')
  await expect(dlg.getByText(/Email isn’t set up/)).toBeVisible()
  await expect(dlg.getByLabel('To')).toHaveValue('dana@example.com')
  await expect(dlg.getByLabel('Subject')).toHaveValue('Invoice INV-1001 from E2E Print Shop')
  await expect(dlg.getByLabel('Message')).toHaveValue(/balance due is \$120\.42/)
  await dlg.getByRole('button', { name: /Save PDF & copy message/ }).click()
  await expect.poll(pdfs, { timeout: 20000 }).toContain('INV-1001_Riverside_Brewing.pdf')
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(clip).toContain('Subject: Invoice INV-1001 from E2E Print Shop')
})

test('pay in full, receipt, void a payment', async () => {
  await win.getByRole('button', { name: 'Record payment' }).first().click()
  const dlg = win.getByRole('dialog')
  await expect(dlg.getByLabel('Amount')).toHaveValue('120.42')
  await dlg.getByLabel('Check number').fill('1042')
  await dlg.getByRole('button', { name: /Record \$120\.42/ }).click()
  await expect(win.getByRole('heading', { name: 'INV-1001 Paid' })).toBeVisible()

  await win.getByRole('button', { name: 'Preview' }).click()
  const doc = win.getByRole('dialog').locator('.inkdoc')
  await expect(doc).toContainText('PAID')
  await expect(doc).toContainText('Paid in full')
  await expect(doc).toContainText('Check #1042')
  await win.keyboard.press('Escape')

  await win.getByRole('button', { name: 'Open receipt R-1002' }).click()
  await expect.poll(pdfs, { timeout: 20000 }).toContain('R-1002_Riverside_Brewing.pdf')

  await win.getByRole('button', { name: 'Void payment R-1002' }).click()
  await win.getByLabel('Reason (optional)').fill('Bounced')
  await win.getByRole('dialog').getByRole('button', { name: 'Void payment' }).click()
  await expect(win.getByRole('heading', { name: 'INV-1001 Partially paid' })).toBeVisible()
})

test('lists and customer balance', async () => {
  await nav('Invoices')
  await expect(win.getByRole('row', { name: /INV-1001.*Riverside Brewing.*Partially paid.*\$240\.84.*\$120\.42.*\$120\.42/ })).toBeVisible()
  await nav('Customers')
  await expect(win.getByRole('row', { name: /Riverside Brewing.*\$120\.42/ })).toBeVisible()
  await win.getByRole('link', { name: 'Riverside Brewing' }).click()
  await expect(win.getByText('Payments received')).toBeVisible()
})

test('email through SMTP', async () => {
  const ready = await win.evaluate(async (port) => {
    const call: Call = async (d, m, ...a) => {
      const r = await (globalThis as unknown as { rawApi: Record<string, Record<string, (...x: unknown[]) => Promise<{ ok: boolean; data?: unknown; error?: { message: string } }>>> }).rawApi[d][m](...a)
      if (!r.ok) throw new Error(r.error?.message)
      return r.data
    }
    if (!(await call('settings', 'encryptionAvailable'))) return false
    const s = (await call('settings', 'get')) as Record<string, unknown>
    const { smtp_password_set: _p, setup_completed_at: _s, last_backup_at: _l, updated_at: _u, quote_last_issued: _q, invoice_last_issued: _i, receipt_last_issued: _r, ...edit } = s
    await call('settings', 'save', { ...edit, smtp_host: '127.0.0.1', smtp_port: port, smtp_secure: false, smtp_user: 'shop@example.com', smtp_from_name: 'E2E Print Shop' })
    await call('settings', 'setSmtpPassword', 'secret')
    return true
  }, smtpPort)
  test.skip(!ready, 'No secure storage on this machine, so an SMTP password can’t be saved')
  await nav('Invoices')
  await win.getByRole('row', { name: /INV-1001/ }).click()
  await win.getByRole('button', { name: 'Email', exact: true }).click()
  const dlg = win.getByRole('dialog')
  await dlg.getByLabel('Cc (optional)').fill('owner@example.com')
  await dlg.getByRole('button', { name: 'Send' }).click()
  await expect(win.getByText('Sent to dana@example.com')).toBeVisible({ timeout: 20000 })
  expect(received).toHaveLength(1)
  expect(received[0].to.sort()).toEqual(['dana@example.com', 'owner@example.com'])
  expect(received[0].raw).toContain('Subject: Invoice INV-1001 from E2E Print Shop')
  expect(received[0].raw).toContain('filename=INV-1001_Riverside_Brewing.pdf')
  expect(errors).toEqual([])
})
