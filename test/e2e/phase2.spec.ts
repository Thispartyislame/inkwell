import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let app: ElectronApplication
let win: Page
let dataDir: string
const errors: string[] = []
const nav = (name: string) => win.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click()
const line = (n: number) => win.getByRole('region', { name: `Line item ${n}` })

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-e2e2-'))
  app = await electron.launch({
    args: [path.join(__dirname, '../..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, INKWELL_USER_DATA: dataDir }
  })
  win = await app.firstWindow()
  win.on('pageerror', (e) => errors.push(e.message))
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await win.setViewportSize({ width: 1440, height: 900 })
  // Set up the shop and a customer through the API to keep this test about quotes.
  await win.evaluate(async () => {
    const call = async (d: string, m: string, ...a: unknown[]) => {
      const r = await (globalThis as unknown as { rawApi: Record<string, Record<string, (...x: unknown[]) => Promise<{ ok: boolean; data?: unknown; error?: { message: string } }>>> }).rawApi[d][m](...a)
      if (!r.ok) throw new Error(r.error?.message)
      return r.data
    }
    await call('settings', 'completeSetup', { shop_name: 'E2E Print Shop', address_line1: '', address_line2: '', city: '', state: '', postal_code: '', phone: '', email: '', website: '', default_tax_bp: 800, quote_prefix: 'Q-', quote_next_number: 1001, invoice_prefix: 'INV-', invoice_next_number: 1001, payment_terms: 'due_on_receipt', payment_terms_days: 0, default_deposit_bp: 5000, quote_expiration_days: 30, terms_text: 'Terms here.' })
    await call('customers', 'save', { company_name: 'Riverside Brewing', first_name: 'Dana', last_name: 'Ortiz', email: 'dana@example.com', phone: '', billing_line1: '', billing_line2: '', billing_city: '', billing_state: '', billing_postal_code: '', shipping_same_as_billing: true, shipping_line1: '', shipping_line2: '', shipping_city: '', shipping_state: '', shipping_postal_code: '', tax_exempt: false, exempt_cert_number: '', exempt_cert_attachment_id: null, exempt_cert_expires_on: null, pricing_matrix_id: null, notes: '', tags: [] })
  })
  await win.reload()
})

test.afterAll(async () => {
  await app?.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('build a quote', async () => {
  await nav('Quotes')
  await win.getByRole('button', { name: 'New quote' }).click()
  await expect(win.getByRole('heading', { name: /Q-1001/ })).toBeVisible()

  await win.getByRole('combobox', { name: 'Customer' }).click()
  await win.keyboard.type('river')
  await win.keyboard.press('Enter')
  await expect(win.getByRole('combobox', { name: 'Customer' })).toHaveValue('Riverside Brewing')
  await win.getByLabel('Job name').fill('Staff tees')

  await win.getByRole('button', { name: 'Add line item' }).click()
  await line(1).getByRole('combobox', { name: 'Garment' }).fill('gildan 5000')
  await win.keyboard.press('Enter')
  await line(1).getByLabel('Garment color').selectOption('Black')
  await line(1).getByLabel('Quantity M').fill('12')
  await line(1).getByLabel('Quantity L').fill('12')
  await line(1).getByRole('button', { name: 'Add imprint' }).click()
  await line(1).getByLabel('Ink colors').fill('3')
  // dark garment: underbase suggested
  await expect(line(1).getByRole('switch')).toBeChecked()

  // Same design on navy: duplicate, change color
  await line(1).getByRole('button', { name: 'Duplicate' }).click()
  await line(2).getByLabel('Garment color').selectOption('Navy')
  await line(2).getByLabel('Quantity M').fill('24')
  await line(2).getByLabel('Quantity L').fill('0')

  // 48 pieces combined: garment $5.00 + 4-color column at 48 ($4.20) = $9.20
  await line(1).getByRole('button', { name: /Pricing breakdown/ }).click()
  await expect(line(1).getByText(/Priced at 48 pcs \(combined/)).toBeVisible()
  await expect(line(1)).toContainText('$220.80') // 24 × $9.20

  // Manual price override on line 2
  await line(2).getByRole('button', { name: /Pricing breakdown/ }).click()
  await line(2).getByLabel('Override unit price S–XL').fill('9.00')
  await expect(line(2)).toContainText('$216.00')
  await expect(line(2).getByText('Manual', { exact: true })).toBeVisible()

  // Fees: screens automatic (4 screens × $25), plus a preset
  await expect(win.getByText('Screens / setup (4 screens)')).toBeVisible()
  await win.getByLabel('Add fee').selectOption({ label: 'Fold & Bag ($0.75 per piece)' })
  await expect(win.getByLabel('Fee name')).toHaveValue('Fold & Bag')

  await win.getByPlaceholder('Never shown to the customer').fill('Customer haggles on price')
  await win.getByPlaceholder('Shown on the quote PDF').fill('Thanks for the order!')
  // items 220.80 + 216.00 = 436.80; fees 100 + 36 = 136; subtotal 572.80; tax 8% = 45.82; total 618.62
  await expect(win.getByText('$618.62').first()).toBeVisible()
  await expect(win.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5000 })
})

test('autosaved and reloads', async () => {
  await nav('Quotes')
  await expect(win.getByRole('row', { name: /Q-1001.*Riverside Brewing.*Staff tees.*\$618\.62/ })).toBeVisible()
  await win.getByRole('row', { name: /Q-1001/ }).click()
  await expect(line(2).getByLabel('Garment color')).toHaveValue('Navy')
  await expect(win.getByPlaceholder('Never shown to the customer')).toHaveValue('Customer haggles on price')
})

test('preview never shows internal data', async () => {
  await win.getByRole('button', { name: 'Preview' }).click()
  const dlg = win.getByRole('dialog')
  await expect(dlg.getByRole('heading', { name: 'Quote', exact: true })).toBeVisible()
  const doc = dlg.locator('.inkdoc')
  await expect(doc).toContainText('Thanks for the order!')
  await expect(doc).toContainText('$618.62')
  await expect(doc).not.toContainText('haggles')
  await expect(doc).not.toContainText(/margin|profit|cost/i)
  await win.keyboard.press('Escape')
})

test('PDF, send, revise', async () => {
  await win.getByRole('button', { name: 'Open PDF' }).click()
  // openPath fails without a desktop; the PDF is still written
  await expect
    .poll(() => (fs.existsSync(path.join(dataDir, 'pdfs')) ? fs.readdirSync(path.join(dataDir, 'pdfs')) : []), { timeout: 20000 })
    .toEqual(['Q-1001_Riverside_Brewing_Staff_tees.pdf'])
  const pdf = fs.readFileSync(path.join(dataDir, 'pdfs', 'Q-1001_Riverside_Brewing_Staff_tees.pdf'))
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')

  await win.getByRole('button', { name: 'Mark as sent' }).click()
  await expect(win.getByRole('heading', { name: 'Q-1001 Sent' })).toBeVisible()
  await expect(line(1).getByLabel('Quantity M')).toBeDisabled()

  await win.getByRole('button', { name: 'Revise' }).click()
  await expect(win.getByRole('heading', { name: /Q-1001-R2/ })).toBeVisible()
  await expect(line(1).getByLabel('Quantity M')).toBeEnabled()
  await expect(win.getByRole('link', { name: 'Q-1001', exact: true })).toBeVisible()
  await expect(win.getByText('$618.62').first()).toBeVisible()
})

test('reorder and Ctrl+N', async () => {
  await win.getByRole('button', { name: 'More actions' }).click()
  await win.getByRole('menuitem', { name: 'Reorder this job' }).click()
  await expect(win.getByRole('heading', { name: /Q-1002/ })).toBeVisible()
  await expect(win.getByText(/1 reorder ×|reorder × \$12\.50/).first()).toBeVisible()
  await win.keyboard.press('Control+N')
  await expect(win.getByRole('heading', { name: /Q-1003/ })).toBeVisible()
  expect(errors).toEqual([])
})
