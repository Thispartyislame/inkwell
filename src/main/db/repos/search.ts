import type Database from 'better-sqlite3'
import type { SearchResult } from '@shared/ipc'
import { customerDisplayName } from '@shared/schemas'
import { listCustomers } from './customers'
import { listGarments } from './garments'

/** Global search. Quotes and invoices join this list in Phases 2 and 3. */
export function globalSearch(db: Database.Database, query: string, limit = 8): SearchResult[] {
  const q = query.trim()
  if (!q) return []
  const customers = listCustomers(db, { search: q })
    .slice(0, limit)
    .map<SearchResult>((c) => ({
      kind: 'customer',
      id: c.id,
      title: customerDisplayName(c),
      subtitle: [c.company_name && `${c.first_name} ${c.last_name}`.trim(), c.email, c.phone].filter(Boolean).join(' · ')
    }))
  const garments = listGarments(db, { search: q })
    .slice(0, limit)
    .map<SearchResult>((g) => ({ kind: 'garment', id: g.id, title: `${g.brand} ${g.style_number}`.trim() || g.name, subtitle: g.name }))
  return [...customers, ...garments]
}
