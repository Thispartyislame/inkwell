import type Database from 'better-sqlite3'
import type { SetupInput } from '@shared/ipc'
import { formatDocNumber } from '@shared/numbering'
import { SettingsSchema, type Settings, type SettingsInput } from '@shared/schemas'
import { parseOrThrow, UserError } from '../errors'
import { fromRow, now, toRow, update } from '../rows'

const SPEC = { bool: ['combine_quantities', 'smtp_secure'] } as const

export function getSettings(db: Database.Database): Settings {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get() as Record<string, unknown>
  const { smtp_password_enc, ...rest } = row
  return { ...fromRow<Omit<Settings, 'smtp_password_set'>>(rest, SPEC), smtp_password_set: smtp_password_enc != null }
}

export function saveSettings(db: Database.Database, input: SettingsInput): Settings {
  const s = parseOrThrow(SettingsSchema, input)
  return db.transaction(() => {
    const cur = getSettings(db)
    const fields: Record<string, string> = {}
    for (const kind of ['quote', 'invoice', 'receipt'] as const) {
      const last = cur[`${kind}_last_issued`]
      if (s[`${kind}_next_number`] <= last)
        fields[`${kind}_next_number`] = `Must be higher than ${last}, the last number already used`
    }
    if (Object.keys(fields).length) throw new UserError(Object.values(fields)[0], fields)
    update(db, 'settings', 1, toRow(s, SPEC))
    return getSettings(db)
  })()
}

/** The user-editable subset of settings, e.g. to merge a partial change into. */
export function editableSettings(s: Settings): SettingsInput {
  return Object.fromEntries(Object.keys(SettingsSchema.shape).map((k) => [k, s[k as keyof Settings]])) as SettingsInput
}

export function completeSetup(db: Database.Database, input: SetupInput): Settings {
  if (!input.shop_name?.trim()) throw new UserError('Enter your shop name', { shop_name: 'Required' })
  const cur = getSettings(db)
  const editable = editableSettings(cur)
  return db.transaction(() => {
    const saved = saveSettings(db, { ...editable, ...input })
    db.prepare('UPDATE settings SET setup_completed_at = ? WHERE id = 1').run(now())
    return { ...saved, setup_completed_at: getSettings(db).setup_completed_at }
  })()
}

export function setLogoPath(db: Database.Database, relPath: string | null): Settings {
  db.prepare('UPDATE settings SET logo_path = ?, updated_at = ? WHERE id = 1').run(relPath, now())
  return getSettings(db)
}

export function setSmtpPasswordEnc(db: Database.Database, enc: Buffer | null): Settings {
  db.prepare('UPDATE settings SET smtp_password_enc = ?, updated_at = ? WHERE id = 1').run(enc, now())
  return getSettings(db)
}

export function getSmtpPasswordEnc(db: Database.Database): Buffer | null {
  return (db.prepare('SELECT smtp_password_enc AS p FROM settings WHERE id = 1').get() as { p: Buffer | null }).p
}

export function setLastBackupAt(db: Database.Database, iso: string): void {
  db.prepare('UPDATE settings SET last_backup_at = ? WHERE id = 1').run(iso)
}

/**
 * Take the next document number. Must run inside the same transaction that creates the
 * document. Numbers only ever move forward, so a number is never reused, even after a
 * document is archived or a transaction later in the app fails (the rollback undoes both).
 */
export function allocateNumber(db: Database.Database, kind: 'quote' | 'invoice' | 'receipt'): { number: string; n: number } {
  if (!db.inTransaction) throw new Error('allocateNumber must run inside a transaction')
  const row = db.prepare(`SELECT ${kind}_prefix AS prefix, ${kind}_next_number AS next FROM settings WHERE id = 1`).get() as {
    prefix: string
    next: number
  }
  db.prepare(`UPDATE settings SET ${kind}_last_issued = ?, ${kind}_next_number = ? WHERE id = 1`).run(row.next, row.next + 1)
  return { number: formatDocNumber(row.prefix, row.next), n: row.next }
}
