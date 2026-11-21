import type Database from 'better-sqlite3'
import { fileUrl, IMAGE_MIME } from '@shared/files'
import { isProductionStatus, PRODUCTION_LABELS, type BoardJob, type GarmentOrder, type GarmentOrderItem, type JobRef, type ProductionStatus } from '@shared/production'
import type { QuoteLine } from '@shared/quote'
import { customerDisplayName, SUPPLIER_LABELS } from '@shared/schemas'
import { sizeGroup, sortSizes } from '@shared/sizes'
import { NotFoundError, UserError } from '../errors'
import { now } from '../rows'
import { logActivity } from './activity'
import { loadInvoice } from './invoices'
import { loadQuote } from './quotes'

type DB = Database.Database

export function setProductionStatus(db: DB, job: JobRef, status: ProductionStatus | null): void {
  if (status !== null && !isProductionStatus(status)) throw new UserError('Unknown production status')
  const table = job.kind === 'quote' ? 'quotes' : 'invoices'
  db.transaction(() => {
    const row = db.prepare(`SELECT production_status FROM ${table} WHERE id = ?`).get(job.id) as { production_status: string | null } | undefined
    if (!row) throw new NotFoundError(job.kind === 'quote' ? 'Quote' : 'Invoice', job.id)
    if (row.production_status === status) return
    db.prepare(`UPDATE ${table} SET production_status = ?, production_updated_at = ? WHERE id = ?`).run(status, now(), job.id)
    logActivity(db, job.kind, job.id, 'production', { to: status ? PRODUCTION_LABELS[status] : 'Not tracked' })
  })()
}

/** Jobs on the board: live invoices being tracked, and approved quotes not yet invoiced. Finished jobs show for 30 days. */
export function boardJobs(db: DB): BoardJob[] {
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const rows = db
    .prepare(
      `SELECT 'invoice' AS kind, i.id, i.number, i.job_name, i.in_hands_on, i.production_status AS status, i.production_updated_at AS updated_at, i.totals, i.total_cents,
          c.company_name, c.first_name, c.last_name, i.customer_id
         FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
         WHERE i.archived_at IS NULL AND i.status <> 'void' AND i.production_status IS NOT NULL
           AND (i.production_status <> 'done' OR i.production_updated_at >= @cutoff)
       UNION ALL
       SELECT 'quote', q.id, q.number, q.job_name, q.in_hands_on, COALESCE(q.production_status, 'awaiting_art'), q.production_updated_at, q.totals, q.total_cents,
          c.company_name, c.first_name, c.last_name, q.customer_id
         FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id
         WHERE q.archived_at IS NULL AND q.status = 'approved' AND q.converted_invoice_id IS NULL
           AND (COALESCE(q.production_status, '') <> 'done' OR q.production_updated_at >= @cutoff)
`
    )
    .all({ cutoff }) as Array<Record<string, unknown>>
  // A mockup on the PDF first; otherwise a film preview from separations.
  const thumb = db.prepare(`SELECT rel_path, mime FROM attachments WHERE owner_type = ? AND owner_id = ? AND (include_in_pdf = 1 OR kind = 'film') ORDER BY include_in_pdf DESC, sort_order, id`)
  // Soonest in-hands date first; jobs without one go last.
  rows.sort((a, b) => String(a.in_hands_on ?? '9999').localeCompare(String(b.in_hands_on ?? '9999')) || String(a.number).localeCompare(String(b.number)))
  return rows.map((r) => {
    const img = (thumb.all(r.kind, r.id) as { rel_path: string; mime: string }[]).find((a) => IMAGE_MIME.test(a.mime))
    return {
      kind: r.kind as JobRef['kind'],
      id: r.id as number,
      number: r.number as string,
      customer: r.customer_id ? customerDisplayName({ company_name: (r.company_name as string) ?? '', first_name: (r.first_name as string) ?? '', last_name: (r.last_name as string) ?? '' }) : '',
      job_name: r.job_name as string,
      status: r.status as ProductionStatus,
      in_hands_on: (r.in_hands_on as string) ?? null,
      pieces: (JSON.parse((r.totals as string) || '{}') as { pieces?: number }).pieces ?? 0,
      total_cents: r.total_cents as number,
      thumbnail: img ? fileUrl(img.rel_path) : '',
      updated_at: (r.updated_at as string) ?? null
    }
  })
}

/**
 * One combined order for blank garments across jobs: supplier → style → color → size.
 * Customer-supplied garments are left out.
 */
export function garmentOrder(db: DB, jobs: JobRef[]): GarmentOrder {
  if (!jobs.length) throw new UserError('Pick at least one job')
  const out: GarmentOrder = { jobs: [], size_columns: [], groups: [], total: 0, est_cost_cents: 0, skipped_customer_supplied: 0 }
  const items = new Map<string, GarmentOrderItem & { supplier: string }>()
  const sizes = new Set<string>()
  for (const j of jobs) {
    const doc = j.kind === 'quote' ? loadQuote(db, j.id) : loadInvoice(db, j.id)
    const c = doc.customer_id ? (db.prepare('SELECT company_name, first_name, last_name FROM customers WHERE id = ?').get(doc.customer_id) as { company_name: string; first_name: string; last_name: string }) : null
    out.jobs.push({ ...j, number: doc.number, customer: c ? customerDisplayName(c) : '', job_name: doc.job_name })
    for (const l of doc.lines as QuoteLine[]) {
      const qty = l.sizes.reduce((t, s) => t + s.qty, 0)
      if (!qty) continue
      if (l.customer_supplied) {
        out.skipped_customer_supplied++
        continue
      }
      const g = l.garment
      const supplier = g.supplier === 'other' ? g.supplier_other || 'Other / unspecified' : SUPPLIER_LABELS[g.supplier]
      const name = g.name || l.description || 'Custom item'
      const key = [supplier, g.brand, g.style_number, name, l.color_name].map((x) => x.trim().toLowerCase()).join('|')
      const item = items.get(key) ?? { supplier, brand: g.brand, style_number: g.style_number, name, color: l.color_name || '(no color)', sizes: {}, total: 0, est_cost_cents: 0 }
      for (const s of l.sizes) {
        if (!s.qty) continue
        item.sizes[s.size] = (item.sizes[s.size] ?? 0) + s.qty
        item.total += s.qty
        item.est_cost_cents += s.qty * l.costs[sizeGroup(s.size)]
        sizes.add(s.size)
      }
      items.set(key, item)
    }
  }
  out.size_columns = sortSizes([...sizes])
  const bySupplier = new Map<string, GarmentOrder['groups'][number]>()
  const sorted = [...items.values()].sort((a, b) => a.supplier.localeCompare(b.supplier) || `${a.brand} ${a.style_number}`.localeCompare(`${b.brand} ${b.style_number}`) || a.color.localeCompare(b.color))
  for (const { supplier, ...item } of sorted) {
    const grp = bySupplier.get(supplier) ?? { supplier, items: [], total: 0, est_cost_cents: 0 }
    grp.items.push(item)
    grp.total += item.total
    grp.est_cost_cents += item.est_cost_cents
    bySupplier.set(supplier, grp)
  }
  out.groups = [...bySupplier.values()]
  out.total = out.groups.reduce((t, g) => t + g.total, 0)
  out.est_cost_cents = out.groups.reduce((t, g) => t + g.est_cost_cents, 0)
  return out
}
