import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backupDatabase, backupIsDue, listBackups, pruneBackups, replaceDatabaseFile, validateBackup } from '../../src/main/backup/backup'
import { openDatabase } from '../../src/main/db/connection'
import { saveCustomer } from '../../src/main/db/repos/customers'
import { listCustomers } from '../../src/main/db/repos/customers'
import { resolveInside } from '../../src/main/files/files'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-backup-'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const addCustomer = (db: Database.Database, name: string) =>
  saveCustomer(db, {
    company_name: name, first_name: '', last_name: '', email: '', phone: '',
    billing_line1: '', billing_line2: '', billing_city: '', billing_state: '', billing_postal_code: '',
    shipping_same_as_billing: true, shipping_line1: '', shipping_line2: '', shipping_city: '', shipping_state: '', shipping_postal_code: '',
    tax_exempt: false, exempt_cert_number: '', exempt_cert_attachment_id: null, exempt_cert_expires_on: null, pricing_matrix_id: null, notes: '', tags: []
  })

describe('backups', () => {
  it('backs up a live database and restores it', async () => {
    const dbFile = path.join(dir, 'inkwell.db')
    const db = openDatabase(dbFile)
    addCustomer(db, 'Before backup')
    const b = await backupDatabase(db, path.join(dir, 'backups'))
    addCustomer(db, 'After backup')
    expect(validateBackup(b.path, 999).schemaVersion).toBeGreaterThan(0)
    db.close()

    replaceDatabaseFile(b.path, dbFile)
    const restored = openDatabase(dbFile)
    expect(listCustomers(restored).map((c) => c.company_name)).toEqual(['Before backup'])
    restored.close()
  })

  it('keeps only the newest 30', () => {
    const bdir = path.join(dir, 'backups')
    fs.mkdirSync(bdir)
    for (let d = 1; d <= 35; d++) fs.writeFileSync(path.join(bdir, `inkwell-2026-01-${String(d).padStart(2, '0')}_120000.db`), 'x')
    fs.writeFileSync(path.join(bdir, 'unrelated.txt'), 'keep me')
    const deleted = pruneBackups(bdir, 30)
    expect(deleted).toHaveLength(5)
    expect(deleted[0]).toBe('inkwell-2026-01-05_120000.db')
    expect(listBackups(bdir)).toHaveLength(30)
    expect(listBackups(bdir)[0].file).toBe('inkwell-2026-01-35_120000.db')
    expect(fs.existsSync(path.join(bdir, 'unrelated.txt'))).toBe(true)
  })

  it('rejects files that are not Inkwell databases or are too new', () => {
    const junk = path.join(dir, 'junk.db')
    fs.writeFileSync(junk, 'definitely not sqlite, just some text that is long enough to have a header')
    expect(() => validateBackup(junk, 99)).toThrow(/not an Inkwell database/)

    const other = path.join(dir, 'other.db')
    new Database(other).exec('CREATE TABLE foo (x)').close()
    expect(() => validateBackup(other, 99)).toThrow(/not an Inkwell database/)

    const newer = path.join(dir, 'newer.db')
    const db = openDatabase(newer)
    db.prepare("INSERT INTO schema_migrations VALUES (999, 'future', 'x')").run()
    db.close()
    expect(() => validateBackup(newer, 5)).toThrow(/newer version/)
  })

  it('is due once a day', () => {
    const now = Date.parse('2026-11-21T12:00:00Z')
    expect(backupIsDue(null, now)).toBe(true)
    expect(backupIsDue('2026-11-21T01:00:00Z', now)).toBe(false)
    expect(backupIsDue('2026-11-20T11:59:00Z', now)).toBe(true)
  })
})

describe('resolveInside', () => {
  it('refuses paths that escape the data folder', () => {
    expect(resolveInside('/data', 'attachments/a.png')).toBe(path.resolve('/data/attachments/a.png'))
    expect(() => resolveInside('/data', '../etc/passwd')).toThrow()
    expect(() => resolveInside('/data', 'attachments/../../x')).toThrow()
    expect(() => resolveInside('/data', '/etc/passwd')).toThrow()
  })
})
