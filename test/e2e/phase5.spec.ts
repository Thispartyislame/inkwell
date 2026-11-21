import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let app: ElectronApplication
let win: Page
let dataDir: string
let outDir: string
let quoteId = 0
const errors: string[] = []
const nav = (name: string) => win.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click()
const logo = path.join(__dirname, '../fixtures/separations/three-color-logo.svg')

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-e2e5-'))
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-films-'))
  app = await electron.launch({ args: [path.join(__dirname, '../..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], env: { ...process.env, INKWELL_USER_DATA: dataDir } })
  win = await app.firstWindow()
  win.on('pageerror', (e) => errors.push(e.message))
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await win.setViewportSize({ width: 1440, height: 900 })
  // Native file dialogs can't be clicked in tests: answer them from the main process.
  await app.evaluate(({ dialog }, out) => {
    dialog.showSaveDialog = (async (...a: unknown[]) => {
      const opts = (a.length > 1 ? a[1] : a[0]) as { defaultPath?: string }
      return { canceled: false, filePath: `${out}/${opts.defaultPath ?? 'out.pdf'}` }
    }) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [out] })) as typeof dialog.showOpenDialog
  }, outDir)
  quoteId = await win.evaluate(async () => {
    type R = { ok: boolean; data?: unknown; error?: { message: string } }
    const call = async (d: string, m: string, ...a: unknown[]): Promise<any> => {
      const r: R = await (globalThis as unknown as { rawApi: Record<string, Record<string, (...x: unknown[]) => Promise<R>>> }).rawApi[d][m](...a)
      if (!r.ok) throw new Error(r.error?.message)
      return r.data
    }
    await call('settings', 'completeSetup', { shop_name: 'E2E Print Shop', address_line1: '', address_line2: '', city: '', state: '', postal_code: '', phone: '', email: '', website: '', default_tax_bp: 0, quote_prefix: 'Q-', quote_next_number: 1001, invoice_prefix: 'INV-', invoice_next_number: 1001, payment_terms: 'due_on_receipt', payment_terms_days: 0, default_deposit_bp: 0, quote_expiration_days: 30, terms_text: '' })
    const q = await call('quotes', 'create', {})
    const keys = ['id', 'customer_id', 'contact_id', 'job_name', 'issued_on', 'expires_on', 'in_hands_on', 'customer_notes', 'internal_notes', 'tax_bp_override', 'discount_mode', 'discount_value', 'deposit_bp', 'rush', 'charge_tax_anyway', 'is_reorder', 'disabled_auto_fees']
    const line = { uid: 'l1', garment_id: null, garment: { brand: '', style_number: '', name: 'Tee', category: 'tee', supplier: 'other', supplier_other: '' }, costs: { base: 300, '2xl': 0, '3xl': 0, '4xl_plus': 0 }, description: '', customer_supplied: false, color_name: 'Black', color_hex: '#111111', is_dark: true, sizes: [{ size: 'M', qty: 24 }], imprints: [{ uid: 'front', location: 'front', location_custom: '', method: 'screen', colors: 1, underbase: false, underbase_source: 'auto', specialty: [], print_size: 'standard', stitch_count: 0, new_digitizing: false, transfer_size: 1, is_reorder: false, matrix_id: null, notes: '' }], overrides: {}, override_reason: '' }
    await call('quotes', 'save', { ...Object.fromEntries(keys.map((k) => [k, q[k]])), job_name: 'Logo tees', lines: [line], fees: [] })
    return q.id
  })
  await win.reload()
})

test.afterAll(async () => {
  await app?.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.rmSync(outDir, { recursive: true, force: true })
})

test('open artwork and see its colors', async () => {
  await nav('Separations')
  await expect(win.getByRole('heading', { name: 'Separations' })).toBeVisible()
  // the picker is answered with outDir; open the fixture through the drop path instead
  const id = await win.evaluate(async (file) => {
    const r = await (globalThis as unknown as { rawApi: Record<string, Record<string, (...x: unknown[]) => Promise<{ ok: boolean; data?: { id: number } }>>> }).rawApi.separations.fromFile([file])
    return r.data!.id
  }, logo)
  await win.evaluate((i) => (location.hash = `#/separations/${i}`), id)
  await expect(win.getByText('Colors (4 found)')).toBeVisible({ timeout: 15000 })
  await expect(win.getByText('#ff0000', { exact: true })).toBeVisible()
  // white garment: 3 screens after merging the near-identical red
  await win.getByRole('button', { name: 'Merge similar' }).click()
  await expect(win.getByLabel('Merge #fe0101 into')).toHaveValue('#ff0000')
  await expect(win.getByRole('list', { name: 'Screens' }).getByRole('listitem')).toHaveCount(3)
  // black garment: underbase is added and black ink drops out (the shirt shows through)
  await win.getByLabel('Garment Black').click()
  await expect(win.getByRole('list', { name: 'Screens' }).getByText('1. Underbase white')).toBeVisible()
  await expect(win.getByRole('list', { name: 'Screens' }).getByRole('listitem')).toHaveCount(3)
})

test('export films', async () => {
  await win.getByRole('button', { name: 'Save films PDF' }).click()
  await expect(win.getByText(/Films saved:/)).toBeVisible({ timeout: 30000 })
  const pdf = fs.readdirSync(outDir).find((f) => f.endsWith('.pdf'))!
  expect(pdf).toBeTruthy()
  // one page per screen, each exactly 11 × 17 in (792 × 1224 pt)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(outDir, pdf))) }).promise
  expect(doc.numPages).toBe(3)
  for (let p = 1; p <= doc.numPages; p++) expect((await doc.getPage(p)).view.map(Math.round)).toEqual([0, 0, 792, 1224])

  await win.getByRole('button', { name: 'PNGs' }).click()
  await expect(win.getByText(/Saved to/).first()).toBeVisible({ timeout: 60000 })
  const pngs = fs.readdirSync(outDir).filter((f) => f.endsWith('.png'))
  expect(pngs).toHaveLength(3)
})

test('link to a quote imprint', async () => {
  await win.getByRole('button', { name: 'Link to imprint…' }).click()
  const dlg = win.getByRole('dialog')
  await dlg.getByLabel('Quote or invoice').selectOption({ label: 'Q-1001 · No customer · Logo tees' })
  await dlg.getByLabel('Imprint').selectOption({ index: 1 })
  await dlg.getByRole('button', { name: 'Link' }).click()
  await expect(win.getByText(/Linked: the imprint now has 2 colors \+ underbase/)).toBeVisible()
  await win.evaluate((id) => (location.hash = `#/quotes/${id}`), quoteId)
  const line = win.getByRole('region', { name: 'Line item 1' })
  await expect(line.getByText('From separations')).toBeVisible()
  await expect(line.getByLabel('Ink colors')).toHaveValue('2')
  await expect(line.getByRole('switch')).toBeChecked()
  // 2 colors + underbase = 3 screens
  await expect(win.getByText('Screens / setup (3 screens)')).toBeVisible()
  expect(errors).toEqual([])
})
