import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import type { BackupInfo } from '@shared/ipc'

export const KEEP_BACKUPS = 30
const NAME = /^inkwell-\d{4}-\d{2}-\d{2}_\d{6}(?:-[a-z0-9-]+)?\.db$/

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function listBackups(dir: string): BackupInfo[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => NAME.test(f))
    .map((file) => {
      const p = path.join(dir, file)
      const st = fs.statSync(p)
      return { file, path: p, size_bytes: st.size, created_at: st.mtime.toISOString() }
    })
    .sort((a, b) => b.file.localeCompare(a.file))
}

/** Delete all but the newest `keep` backups. Returns deleted file names. */
export function pruneBackups(dir: string, keep = KEEP_BACKUPS): string[] {
  const old = listBackups(dir).slice(keep)
  for (const b of old) fs.rmSync(b.path, { force: true })
  return old.map((b) => b.file)
}

/** Consistent online copy of the live database (safe while the app is using it). */
export async function backupDatabase(db: Database.Database, dir: string, label = ''): Promise<BackupInfo> {
  fs.mkdirSync(dir, { recursive: true })
  const base = `inkwell-${stamp()}${label ? '-' + label : ''}`
  let file = `${base}.db`
  for (let n = 2; fs.existsSync(path.join(dir, file)); n++) file = `${base}-${n}.db`
  const dest = path.join(dir, file)
  await db.backup(dest)
  pruneBackups(dir)
  return listBackups(dir).find((b) => b.file === file)!
}

export function backupIsDue(lastBackupAt: string | null, nowMs = Date.now()): boolean {
  if (!lastBackupAt) return true
  return nowMs - Date.parse(lastBackupAt) >= 24 * 60 * 60 * 1000
}

/**
 * Check a file is an Inkwell database this version can open. Throws a user-readable error.
 */
export function validateBackup(file: string, maxSchemaVersion: number): { schemaVersion: number } {
  let db: Database.Database | null = null
  try {
    db = new Database(file, { readonly: true, fileMustExist: true })
    const ok = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('schema_migrations', 'settings', 'customers')`).get() as { n: number }
    if (ok.n !== 3) throw new Error('not an Inkwell database')
    const integrity = db.pragma('quick_check', { simple: true })
    if (integrity !== 'ok') throw new Error(`the file is damaged (${integrity})`)
    const v = (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v
    if (v > maxSchemaVersion) throw new Error('it was made by a newer version of Inkwell; update the app first')
    return { schemaVersion: v }
  } catch (e) {
    const msg = (e as Error).message
    throw new Error(`Can’t restore this file: ${/file is not a database|SQLITE_NOTADB/i.test(msg) ? 'not an Inkwell database' : msg}`)
  } finally {
    db?.close()
  }
}

/** Replace the live DB file with a backup. The caller must have closed the live connection. */
export function replaceDatabaseFile(backupFile: string, dbFile: string): void {
  const tmp = dbFile + '.restoring'
  fs.copyFileSync(backupFile, tmp)
  for (const ext of ['-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true })
  fs.renameSync(tmp, dbFile)
}
