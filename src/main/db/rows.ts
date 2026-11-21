import type Database from 'better-sqlite3'

export type Row = Record<string, unknown>
export interface RowSpec {
  bool?: readonly string[]
  json?: readonly string[]
}

export const now = () => new Date().toISOString()

/** DB row → domain object: 0/1 → boolean, JSON text → value. */
export function fromRow<T>(row: Row | undefined, spec: RowSpec): T {
  if (!row) return row as T
  const out: Row = { ...row }
  for (const k of spec.bool ?? []) if (k in out) out[k] = out[k] === 1 || out[k] === true
  for (const k of spec.json ?? []) if (typeof out[k] === 'string') out[k] = JSON.parse(out[k] as string)
  return out as T
}

/** Domain object → DB values: boolean → 0/1, objects/arrays → JSON text. */
export function toRow(obj: Row, spec: RowSpec): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    if ((spec.json ?? []).includes(k)) out[k] = JSON.stringify(v)
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0
    else out[k] = v
  }
  return out
}

const columnCache = new WeakMap<Database.Database, Map<string, Set<string>>>()
export function columns(db: Database.Database, table: string): Set<string> {
  let byTable = columnCache.get(db)
  if (!byTable) columnCache.set(db, (byTable = new Map()))
  let cols = byTable.get(table)
  if (!cols) {
    cols = new Set((db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name))
    byTable.set(table, cols)
  }
  return cols
}

/** Keep only keys that are real columns (never id or timestamps) so callers can't write arbitrary SQL. */
function pick(db: Database.Database, table: string, values: Row, extraExcluded: string[] = []): Row {
  const cols = columns(db, table)
  const out: Row = {}
  for (const [k, v] of Object.entries(values)) {
    if (k === 'id' || extraExcluded.includes(k) || !cols.has(k)) continue
    out[k] = v
  }
  return out
}

export function insert(db: Database.Database, table: string, values: Row): number {
  const v = pick(db, table, values)
  const cols = columns(db, table)
  const t = now()
  if (cols.has('created_at') && !('created_at' in v)) v.created_at = t
  if (cols.has('updated_at')) v.updated_at = t
  const keys = Object.keys(v)
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`
  return Number(db.prepare(sql).run(v).lastInsertRowid)
}

export function update(db: Database.Database, table: string, id: number, values: Row): void {
  const v = pick(db, table, values, ['created_at'])
  if (columns(db, table).has('updated_at')) v.updated_at = now()
  const keys = Object.keys(v)
  if (!keys.length) return
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @__id`
  db.prepare(sql).run({ ...v, __id: id })
}

/** Escape a user search string for LIKE ... ESCAPE '\' */
export function likePattern(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`
}
