import Database from 'better-sqlite3'
import { migrate } from './migrate'
import { seedIfEmpty } from './seed'

export function openDatabase(file: string): Database.Database {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  seedIfEmpty(db)
  return db
}
