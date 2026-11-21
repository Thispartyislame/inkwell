import type Database from 'better-sqlite3'
import type { GarmentFilter, ImportResult } from '@shared/ipc'
import { sortSizes } from '@shared/sizes'
import { GarmentSchema, type Garment, type GarmentInput } from '@shared/schemas'
import { NotFoundError, parseOrThrow, UserError } from '../errors'
import { fromRow, insert, likePattern, now, toRow, update } from '../rows'

const SPEC = { bool: ['active'], json: ['colors', 'sizes'] } as const

export function getGarment(db: Database.Database, id: number): Garment {
  const row = db.prepare('SELECT * FROM garments WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) throw new NotFoundError('Garment', id)
  return fromRow<Garment>(row, SPEC)
}

export function listGarments(db: Database.Database, f: GarmentFilter = {}): Garment[] {
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (!f.includeArchived) where.push('archived_at IS NULL')
  if (f.activeOnly) where.push('active = 1')
  if (f.category) {
    where.push('category = @cat')
    params.cat = f.category
  }
  const q = f.search?.trim()
  if (q) {
    // every word must match somewhere: "gildan 5000 black"
    q.split(/\s+/).forEach((w, i) => {
      params[`w${i}`] = likePattern(w)
      where.push(`(brand LIKE @w${i} ESCAPE '\\' OR style_number LIKE @w${i} ESCAPE '\\' OR name LIKE @w${i} ESCAPE '\\' OR colors LIKE @w${i} ESCAPE '\\')`)
    })
  }
  return (
    db
      .prepare(`SELECT * FROM garments ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY brand COLLATE NOCASE, style_number COLLATE NOCASE, name COLLATE NOCASE`)
      .all(params) as Record<string, unknown>[]
  ).map((r) => fromRow<Garment>(r, SPEC))
}

function findByStyle(db: Database.Database, brand: string, style: string, excludeId?: number): Garment | null {
  if (!style.trim()) return null
  const row = db
    .prepare(`SELECT * FROM garments WHERE archived_at IS NULL AND brand = ? COLLATE NOCASE AND style_number = ? COLLATE NOCASE AND id <> ?`)
    .get(brand.trim(), style.trim(), excludeId ?? 0) as Record<string, unknown> | undefined
  return row ? fromRow<Garment>(row, SPEC) : null
}

function normalize(g: GarmentInput): GarmentInput {
  const seen = new Set<string>()
  const colors = g.colors.filter((c) => {
    const k = c.name.trim().toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return { ...g, brand: g.brand.trim(), style_number: g.style_number.trim(), name: g.name.trim(), colors, sizes: sortSizes([...new Set(g.sizes)]) }
}

export function saveGarment(db: Database.Database, input: GarmentInput): Garment {
  const g = normalize(parseOrThrow(GarmentSchema, input))
  return db.transaction(() => {
    const dupe = findByStyle(db, g.brand, g.style_number, g.id)
    if (dupe) throw new UserError(`${g.brand} ${g.style_number} is already in the catalog`, { style_number: 'Already in the catalog' })
    if (g.id) {
      getGarment(db, g.id)
      update(db, 'garments', g.id, toRow(g, SPEC))
      return getGarment(db, g.id)
    }
    return getGarment(db, insert(db, 'garments', toRow(g, SPEC)))
  })()
}

export function duplicateGarment(db: Database.Database, id: number): Garment {
  const { id: _id, created_at: _c, updated_at: _u, archived_at: _a, ...rest } = getGarment(db, id)
  return db.transaction(() => {
    // A copy needs a distinct style number; append "copy", "copy 2", ...
    let style = rest.style_number ? `${rest.style_number} copy` : ''
    for (let n = 2; findByStyle(db, rest.brand, style); n++) style = `${rest.style_number} copy ${n}`
    return getGarment(db, insert(db, 'garments', toRow({ ...rest, style_number: style, name: `${rest.name} (copy)` }, SPEC)))
  })()
}

export function setGarmentArchived(db: Database.Database, id: number, archived: boolean): Garment {
  const g = getGarment(db, id)
  if (!archived) {
    const dupe = findByStyle(db, g.brand, g.style_number, id)
    if (dupe) throw new UserError(`Can’t restore: ${g.brand} ${g.style_number} is already in the catalog`)
  }
  db.prepare('UPDATE garments SET archived_at = ?, updated_at = ? WHERE id = ?').run(archived ? now() : null, now(), id)
  return getGarment(db, id)
}

/**
 * Import garments. 'merge' updates an existing garment with the same brand + style (adds new
 * colors and sizes, replaces costs that are non-zero in the file); 'skip' leaves it alone.
 * All or nothing: one bad row rolls back the whole import.
 */
export function importGarments(db: Database.Database, rows: GarmentInput[], mode: 'merge' | 'skip'): ImportResult {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0 }
  db.transaction(() => {
    rows.forEach((raw, i) => {
      let g: GarmentInput
      try {
        g = normalize(parseOrThrow(GarmentSchema, { ...raw, id: undefined }))
      } catch (e) {
        throw new UserError(`Garment ${i + 1} (${raw.name || raw.style_number}): ${(e as Error).message}`)
      }
      const existing = findByStyle(db, g.brand, g.style_number)
      if (!existing) {
        insert(db, 'garments', toRow(g, SPEC))
        result.created++
      } else if (mode === 'skip') {
        result.skipped++
      } else {
        const names = new Set(existing.colors.map((c) => c.name.toLowerCase()))
        const merged: GarmentInput = {
          ...existing,
          colors: [...existing.colors, ...g.colors.filter((c) => !names.has(c.name.toLowerCase()))],
          sizes: sortSizes([...new Set([...existing.sizes, ...g.sizes])]),
          cost_base_cents: g.cost_base_cents || existing.cost_base_cents,
          cost_2xl_cents: g.cost_2xl_cents || existing.cost_2xl_cents,
          cost_3xl_cents: g.cost_3xl_cents || existing.cost_3xl_cents,
          cost_4xl_plus_cents: g.cost_4xl_plus_cents || existing.cost_4xl_plus_cents
        }
        update(db, 'garments', existing.id, toRow(normalize(merged), SPEC))
        result.updated++
      }
    })
  })()
  return result
}
