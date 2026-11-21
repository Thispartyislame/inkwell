import type Database from 'better-sqlite3'
import {
  FeePresetSchema,
  InkSchema,
  PricingMatrixSchema,
  PricingRulesSchema,
  type FeePreset,
  type FeePresetInput,
  type Ink,
  type InkInput,
  type PricingMatrix,
  type PricingMatrixInput,
  type PricingRules,
  type PricingRulesInput
} from '@shared/schemas'
import { NotFoundError, parseOrThrow } from '../errors'
import { fromRow, insert, now, toRow, update } from '../rows'

type DB = Database.Database
const MATRIX = { bool: ['is_default', 'is_sample'], json: ['breaks', 'columns', 'prices'] } as const
const RULES = { bool: ['is_sample'], json: ['markup_tiers', 'specialty_adders', 'oversize_adders', 'size_upcharges'] } as const
const FEE = { bool: ['taxable', 'is_sample'] } as const

// ---------- matrices ----------
export function getMatrix(db: DB, id: number): PricingMatrix {
  const row = db.prepare('SELECT * FROM pricing_matrices WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) throw new NotFoundError('Pricing matrix', id)
  return fromRow<PricingMatrix>(row, MATRIX)
}

export function listMatrices(db: DB, includeArchived = false): PricingMatrix[] {
  return (
    db.prepare(`SELECT * FROM pricing_matrices ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY method, name COLLATE NOCASE`).all() as Record<string, unknown>[]
  ).map((r) => fromRow<PricingMatrix>(r, MATRIX))
}

export function saveMatrix(db: DB, input: PricingMatrixInput): PricingMatrix {
  const m = parseOrThrow(PricingMatrixSchema, input)
  return db.transaction(() => {
    // Editing a sample makes it yours: drop the "Sample" label.
    const values = { ...toRow(m, MATRIX), is_sample: 0 }
    let id = m.id
    if (id) {
      getMatrix(db, id)
      update(db, 'pricing_matrices', id, values)
    } else id = insert(db, 'pricing_matrices', values)
    if (m.is_default) db.prepare('UPDATE pricing_matrices SET is_default = 0 WHERE method = ? AND id <> ?').run(m.method, id)
    return getMatrix(db, id)
  })()
}

export function duplicateMatrix(db: DB, id: number): PricingMatrix {
  const { id: _i, created_at: _c, updated_at: _u, archived_at: _a, is_sample: _s, ...rest } = getMatrix(db, id)
  return saveMatrix(db, { ...rest, name: `${rest.name} (copy)`, is_default: false })
}

export function setMatrixArchived(db: DB, id: number, archived: boolean): PricingMatrix {
  getMatrix(db, id)
  db.prepare('UPDATE pricing_matrices SET archived_at = ?, is_default = CASE WHEN ? THEN 0 ELSE is_default END, updated_at = ? WHERE id = ?').run(
    archived ? now() : null,
    archived ? 1 : 0,
    now(),
    id
  )
  return getMatrix(db, id)
}

// ---------- rules ----------
export function getRules(db: DB): PricingRules {
  return fromRow<PricingRules>(db.prepare('SELECT * FROM pricing_rules WHERE id = 1').get() as Record<string, unknown>, RULES)
}

export function saveRules(db: DB, input: PricingRulesInput): PricingRules {
  const r = parseOrThrow(PricingRulesSchema, input)
  update(db, 'pricing_rules', 1, { ...toRow(r, RULES), is_sample: 0 })
  return getRules(db)
}

// ---------- fee presets ----------
function getFee(db: DB, id: number): FeePreset {
  const row = db.prepare('SELECT * FROM fee_presets WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) throw new NotFoundError('Fee', id)
  return fromRow<FeePreset>(row, FEE)
}

export function listFees(db: DB, includeArchived = false): FeePreset[] {
  return (
    db.prepare(`SELECT * FROM fee_presets ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY sort_order, name COLLATE NOCASE`).all() as Record<string, unknown>[]
  ).map((r) => fromRow<FeePreset>(r, FEE))
}

export function saveFee(db: DB, input: FeePresetInput): FeePreset {
  const f = parseOrThrow(FeePresetSchema, input)
  const values = { ...toRow(f, FEE), is_sample: 0 }
  if (f.id) {
    getFee(db, f.id)
    update(db, 'fee_presets', f.id, values)
    return getFee(db, f.id)
  }
  return getFee(db, insert(db, 'fee_presets', values))
}

export function setFeeArchived(db: DB, id: number, archived: boolean): FeePreset {
  getFee(db, id)
  db.prepare('UPDATE fee_presets SET archived_at = ?, updated_at = ? WHERE id = ?').run(archived ? now() : null, now(), id)
  return getFee(db, id)
}

// ---------- inks ----------
function getInk(db: DB, id: number): Ink {
  const row = db.prepare('SELECT * FROM inks WHERE id = ?').get(id) as Ink | undefined
  if (!row) throw new NotFoundError('Ink', id)
  return row
}

export function listInks(db: DB, includeArchived = false): Ink[] {
  return db.prepare(`SELECT * FROM inks ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY name COLLATE NOCASE`).all() as Ink[]
}

export function saveInk(db: DB, input: InkInput): Ink {
  const k = parseOrThrow(InkSchema, input)
  if (k.id) {
    getInk(db, k.id)
    update(db, 'inks', k.id, k)
    return getInk(db, k.id)
  }
  return getInk(db, insert(db, 'inks', k))
}

export function setInkArchived(db: DB, id: number, archived: boolean): Ink {
  getInk(db, id)
  db.prepare('UPDATE inks SET archived_at = ?, updated_at = ? WHERE id = ?').run(archived ? now() : null, now(), id)
  return getInk(db, id)
}
