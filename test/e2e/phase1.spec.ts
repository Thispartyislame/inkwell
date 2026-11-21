import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let app: ElectronApplication
let win: Page
let dataDir: string
const errors: string[] = []
const nav = (name: string) => win.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click()

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-e2e-'))
  app = await electron.launch({
    args: [path.join(__dirname, '../..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, INKWELL_USER_DATA: dataDir }
  })
  win = await app.firstWindow()
  win.on('pageerror', (e) => errors.push(e.message))
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
})

test.afterAll(async () => {
  await app?.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('first-run wizard', async () => {
  await expect(win.getByRole('heading', { name: 'Welcome to Inkwell' })).toBeVisible()
  await win.getByRole('button', { name: 'Next' }).click()
  await expect(win.getByText('Enter your shop name')).toBeVisible()
  await win.getByLabel('Shop name').fill('Test Print Co')
  await win.getByLabel('Email').fill('hello@testprint.example')
  await win.getByRole('button', { name: 'Next' }).click()
  await win.getByLabel('Sales tax rate').fill('8.25')
  await win.getByRole('button', { name: 'Next' }).click()
  await expect(win.getByText('Your first quote will be')).toContainText('Q-1001')
  await win.getByRole('button', { name: 'Finish setup' }).click()
  await expect(win.getByRole('heading', { name: 'Welcome, Test Print Co' })).toBeVisible()
  // the daily backup runs on first launch
  await expect(win.getByText('Last backup')).toBeVisible()
})

test('create a customer', async () => {
  await nav('Customers')
  await win.getByRole('button', { name: 'New customer' }).click()
  await win.getByRole('button', { name: 'Save' }).click()
  await expect(win.getByText('Enter a company or a contact name')).toBeVisible()
  await win.getByLabel('Company / organization').fill('Riverside Brewing')
  await win.getByLabel('First name').fill('Dana')
  await win.getByLabel('Email').fill('not-an-email')
  await win.getByRole('button', { name: 'Save' }).click()
  await expect(win.getByText('Enter a valid email address')).toBeVisible()
  await win.getByLabel('Email').fill('dana@riverside.example')
  await win.getByRole('switch', { name: 'Tax-exempt' }).click()
  await win.getByLabel('Resale / exemption certificate #').fill('ST-120-55')
  await win.getByRole('button', { name: 'Save' }).click()
  await expect(win.getByRole('heading', { name: 'Riverside Brewing' })).toBeVisible()
  await expect(win.getByText('Certificate #ST-120-55')).toBeVisible()

  await win.getByRole('button', { name: 'Add contact' }).click()
  await win.getByLabel('Name').fill('Pat Kim')
  await win.getByLabel('Role').fill('Buyer')
  await win.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(win.getByText('Pat Kim · Buyer')).toBeVisible()

  // global search finds it
  await win.keyboard.press('Control+K')
  await win.keyboard.type('river')
  await expect(win.getByRole('option', { name: /Riverside Brewing/ })).toBeVisible()
  await win.keyboard.press('Escape')
})

test('create and duplicate a garment', async () => {
  await nav('Catalog')
  await expect(win.getByText('Heavy Cotton T-Shirt')).toBeVisible() // seeded sample
  await win.getByRole('button', { name: 'New garment' }).click()
  await win.getByLabel('Brand').fill('Comfort Colors')
  await win.getByLabel('Style number').fill('1717')
  await win.getByLabel('Name', { exact: true }).fill('Garment-Dyed Tee')
  await win.getByLabel('New color names').fill('Pepper, Ivory')
  await win.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(win.getByLabel('Color name', { exact: true }).first()).toHaveValue('Pepper')
  await win.getByLabel('Cost S–XL').fill('5.25')
  // sample rules: $5.25 is in the +75% tier → $9.19, margin 42.87%
  await expect(win.getByRole('row', { name: /S–XL/ })).toContainText('$9.19')
  await expect(win.getByRole('row', { name: /S–XL/ })).toContainText('42.87%')
  await win.getByRole('button', { name: 'Save' }).click()
  await expect(win.getByText('Garment added')).toBeVisible()
  await win.getByRole('button', { name: 'Duplicate' }).click()
  await expect(win.getByLabel('Style number')).toHaveValue('1717 copy')
})

test('edit a pricing matrix', async () => {
  await nav('Pricing')
  await expect(win.getByText('Sample: edit these to match your pricing').first()).toBeVisible()
  await win.getByText('Standard Screen Print').click()
  const cell = win.getByLabel('Price for 12+ pieces, column 1')
  await expect(cell).toHaveValue('4.50')
  await cell.fill('4.75')
  await win.getByRole('button', { name: 'Quantity break' }).click()
  await win.getByRole('button', { name: 'Save matrix' }).click()
  await expect(win.getByText('Matrix saved')).toBeVisible()
  await expect(win.getByText('Sample: edit these to match your pricing')).toHaveCount(0)
})

test('price garments by target margin', async () => {
  await nav('Pricing')
  await win.getByRole('tab', { name: 'Pricing rules' }).click()
  await win.getByLabel('Mark up by').selectOption('margin')
  // +100% markup converts to a 50% margin, so prices don't change
  await expect(win.getByLabel('Tier 1 margin')).toHaveValue('50')
  for (const i of [1, 2, 3]) await win.getByLabel(`Tier ${i} margin`).fill('40')
  await expect(win.getByRole('row', { name: /^\$2\.50/ })).toContainText('$4.17')
  await win.getByRole('button', { name: 'Save rules' }).click()
  await expect(win.getByText('Pricing rules saved')).toBeVisible()
  await nav('Catalog')
  // Gildan 5000 costs $2.50 → $4.17 at 40% margin
  await expect(win.getByRole('row', { name: /Gildan 5000/ })).toContainText('$4.17')
  await expect(win.getByRole('row', { name: /Gildan 5000/ })).toContainText('40.05%')
})

test('settings validation and backup', async () => {
  await nav('Settings')
  await win.getByRole('tab', { name: 'Backups' }).click()
  await win.getByRole('button', { name: 'Back up now' }).click()
  await expect(win.getByText('Backup saved')).toBeVisible()
  const backups = fs.readdirSync(path.join(dataDir, 'backups'))
  expect(backups.length).toBeGreaterThanOrEqual(2)

  await win.getByRole('tab', { name: 'About' }).click()
  await expect(win.getByText(dataDir, { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
