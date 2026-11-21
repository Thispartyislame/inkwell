import type Database from 'better-sqlite3'

/**
 * Numbered SQL migrations, bundled at build time. Each file runs once, in order, inside a
 * transaction. Migrations are append-only: never edit one that has shipped.
 */
const files = import.meta.glob('./migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = Object.entries(files)
  .map(([path, sql]) => {
    const file = path.split('/').pop()!
    const m = /^(\d+)_(.+)\.sql$/.exec(file)
    if (!m) throw new Error(`Bad migration file name: ${file}`)
    return { version: Number(m[1]), name: m[2], sql }
  })
  .sort((a, b) => a.version - b.version)

export function migrate(db: Database.Database, migrations: Migration[] = MIGRATIONS): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`)
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version)
  )
  const ran: number[] = []
  for (const m of migrations) {
    if (applied.has(m.version)) continue
    // Foreign keys must be toggled outside a transaction; table rebuilds in later
    // migrations need them off while they run.
    db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        db.exec(m.sql)
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
          m.version,
          m.name,
          new Date().toISOString()
        )
        const problems = db.pragma('foreign_key_check') as unknown[]
        if (problems.length) throw new Error(`Migration ${m.version} broke foreign keys`)
      })()
    } finally {
      db.pragma('foreign_keys = ON')
    }
    ran.push(m.version)
  }
  return ran
}

export function schemaVersion(db: Database.Database): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }
  return row.v ?? 0
}
