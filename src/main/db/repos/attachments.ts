import type Database from 'better-sqlite3'
import type { Attachment } from '@shared/schemas'
import { NotFoundError } from '../errors'
import { fromRow, insert } from '../rows'

const SPEC = { bool: ['include_in_pdf'] } as const

export function getAttachment(db: Database.Database, id: number): Attachment {
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) throw new NotFoundError('Attachment', id)
  return fromRow<Attachment>(row, SPEC)
}

export function findAttachment(db: Database.Database, id: number | null): Attachment | null {
  if (id == null) return null
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? fromRow<Attachment>(row, SPEC) : null
}

export function listAttachments(db: Database.Database, ownerType: Attachment['owner_type'], ownerId: number): Attachment[] {
  return (
    db.prepare('SELECT * FROM attachments WHERE owner_type = ? AND owner_id = ? ORDER BY sort_order, id').all(ownerType, ownerId) as Record<string, unknown>[]
  ).map((r) => fromRow<Attachment>(r, SPEC))
}

export function addAttachment(
  db: Database.Database,
  a: Pick<Attachment, 'owner_type' | 'owner_id' | 'rel_path' | 'original_name' | 'mime' | 'size_bytes' | 'kind'> & Partial<Pick<Attachment, 'caption' | 'include_in_pdf'>>
): Attachment {
  const id = insert(db, 'attachments', { ...a, include_in_pdf: a.include_in_pdf ? 1 : 0 })
  return getAttachment(db, id)
}

export function deleteAttachmentRow(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM attachments WHERE id = ?').run(id)
}
