import type Database from 'better-sqlite3'
import type { ActivityEntry } from '@shared/schemas'
import { fromRow, now } from '../rows'

export function logActivity(db: Database.Database, entityType: string, entityId: number, action: string, details: Record<string, unknown> = {}): void {
  db.prepare('INSERT INTO activity_log (entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)').run(
    entityType,
    entityId,
    action,
    JSON.stringify(details),
    now()
  )
}

export function listActivity(db: Database.Database, entityType: string, entityId: number, limit = 50): ActivityEntry[] {
  return (
    db.prepare('SELECT * FROM activity_log WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT ?').all(entityType, entityId, limit) as Record<string, unknown>[]
  ).map((r) => fromRow<ActivityEntry>(r, { json: ['details'] }))
}
