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

export function updateAttachment(db: Database.Database, id: number, patch: { caption?: string; include_in_pdf?: boolean; kind?: Attachment['kind'] }): Attachment {
  getAttachment(db, id)
  const sets: string[] = []
  const p: Record<string, unknown> = { id }
  if (patch.caption !== undefined) {
    sets.push('caption = @caption')
    p.caption = String(patch.caption).slice(0, 300)
  }
  if (patch.include_in_pdf !== undefined) {
    sets.push('include_in_pdf = @inc')
    p.inc = patch.include_in_pdf ? 1 : 0
  }
  if (patch.kind !== undefined) {
    if (!['mockup', 'artwork', 'proof', 'tax_cert', 'film', 'logo', 'other'].includes(patch.kind)) throw new Error('Bad attachment kind')
    sets.push('kind = @kind')
    p.kind = patch.kind
  }
  if (sets.length) db.prepare(`UPDATE attachments SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(p)
  return getAttachment(db, id)
}
