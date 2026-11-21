import type Database from 'better-sqlite3'
import type { SearchResult } from '@shared/ipc'
import { customerDisplayName } from '@shared/schemas'
import { listCustomers } from './customers'
import { listGarments } from './garments'
import { listQuotes } from './quotes'

/** Global search over quotes, customers and garments. Invoices join in Phase 3. */
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
  const quotes = listQuotes(db, { search: q })
    .slice(0, limit)
    .map<SearchResult>((x) => ({ kind: 'quote', id: x.id, title: `${x.number}${x.job_name ? ` · ${x.job_name}` : ''}`, subtitle: [x.customer_name, x.status].filter(Boolean).join(' · ') }))
  return [...quotes, ...customers, ...garments]
}
