/**
 * Reports. Sales are counted by invoice date (accrual) from issued invoices: anything not draft
 * and not void. Money received is counted by payment date. All amounts in cents.
 */
import type Database from 'better-sqlite3'
import { addDays } from '@shared/dates'
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod } from '@shared/invoice'
import type { QuoteTotals } from '@shared/quote'
import type { DashboardSummary, PaymentsByMethodRow, SalesByCustomerRow, SalesPeriodRow, SalesTaxRow, WinRateReport } from '@shared/reports'
import { customerDisplayName } from '@shared/schemas'

type DB = Database.Database

interface InvoiceFact {
  id: number
  number: string
  customer_id: number | null
  customer_name: string
  issued_on: string
  total: number
  paid: number
  balance: number
  net_sales: number
  shipping: number
  taxable: number
  tax: number
  exempt: boolean
}

/** Issued invoices dated within [from, to], with the money facts reports need. */
function invoiceFacts(db: DB, from: string, to: string): InvoiceFact[] {
  const rows = db
    .prepare(
      `SELECT i.id, i.number, i.customer_id, i.issued_on, i.total_cents, i.paid_cents, i.balance_cents, i.totals, i.pricing_base, i.charge_tax_anyway,
         c.company_name, c.first_name, c.last_name
       FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.status NOT IN ('draft', 'void') AND i.issued_on BETWEEN ? AND ?
       ORDER BY i.issued_on, i.id`
    )
    .all(from, to) as Array<Record<string, unknown>>
  return rows.map((r) => {
    const t = JSON.parse((r.totals as string) || '{}') as Partial<QuoteTotals>
    const pricing = r.pricing_base ? (JSON.parse(r.pricing_base as string) as { customer?: { tax_exempt?: boolean } | null }) : null
    const net = t.net_sales_cents ?? (t.subtotal_cents ?? 0) - (t.discount_cents ?? 0) + (t.rush_cents ?? 0)
    const exempt = t.tax_exempt ?? (!!pricing?.customer?.tax_exempt && !r.charge_tax_anyway && (t.tax_cents ?? 0) === 0)
    return {
      id: r.id as number,
      number: r.number as string,
      customer_id: r.customer_id as number | null,
      customer_name: r.customer_id ? customerDisplayName({ company_name: (r.company_name as string) ?? '', first_name: (r.first_name as string) ?? '', last_name: (r.last_name as string) ?? '' }) : 'No customer',
      issued_on: r.issued_on as string,
      total: r.total_cents as number,
      paid: r.paid_cents as number,
      balance: r.balance_cents as number,
      net_sales: net,
      shipping: t.shipping_cents ?? 0,
      taxable: exempt ? 0 : (t.taxable_cents ?? 0),
      tax: t.tax_cents ?? 0,
      exempt
    }
  })
}

export const periodOf = (iso: string, by: 'month' | 'quarter'): string => {
  const [y, m] = iso.split('-').map(Number)
  return by === 'month' ? iso.slice(0, 7) : `${y}-Q${Math.ceil(m / 3)}`
}

function collectedBy(db: DB, from: string, to: string, by: 'month' | 'quarter'): Map<string, number> {
  const rows = db.prepare(`SELECT received_on, amount_cents FROM payments WHERE voided_at IS NULL AND received_on BETWEEN ? AND ?`).all(from, to) as { received_on: string; amount_cents: number }[]
  const out = new Map<string, number>()
  for (const r of rows) out.set(periodOf(r.received_on, by), (out.get(periodOf(r.received_on, by)) ?? 0) + r.amount_cents)
  return out
}

/** Every period between from and to, so empty months still show as zero. */
function periods(from: string, to: string, by: 'month' | 'quarter'): string[] {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    const p = periodOf(`${y}-${String(m).padStart(2, '0')}-01`, by)
    if (!out.includes(p)) out.push(p)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

export function salesByPeriod(db: DB, from: string, to: string, by: 'month' | 'quarter' = 'month'): SalesPeriodRow[] {
  const facts = invoiceFacts(db, from, to)
  const collected = collectedBy(db, from, to, by)
  return periods(from, to, by).map((period) => {
    const f = facts.filter((x) => periodOf(x.issued_on, by) === period)
    return {
      period,
      invoices: f.length,
      net_sales_cents: f.reduce((t, x) => t + x.net_sales, 0),
      tax_cents: f.reduce((t, x) => t + x.tax, 0),
      shipping_cents: f.reduce((t, x) => t + x.shipping, 0),
      total_cents: f.reduce((t, x) => t + x.total, 0),
      collected_cents: collected.get(period) ?? 0
    }
  })
}

export function salesByCustomer(db: DB, from: string, to: string): SalesByCustomerRow[] {
  const by = new Map<string, SalesByCustomerRow>()
  for (const f of invoiceFacts(db, from, to)) {
    const key = String(f.customer_id ?? 0)
    const r = by.get(key) ?? { customer_id: f.customer_id, customer: f.customer_name, invoices: 0, net_sales_cents: 0, tax_cents: 0, total_cents: 0, paid_cents: 0, balance_cents: 0 }
    r.invoices++
    r.net_sales_cents += f.net_sales
    r.tax_cents += f.tax
    r.total_cents += f.total
    r.paid_cents += f.paid
    r.balance_cents += f.balance
    by.set(key, r)
  }
  return [...by.values()].sort((a, b) => b.net_sales_cents - a.net_sales_cents || a.customer.localeCompare(b.customer))
}

/** Taxable vs exempt vs non-taxable sales and tax charged, for filing. */
export function salesTax(db: DB, from: string, to: string, by: 'month' | 'quarter' = 'month'): SalesTaxRow[] {
  const facts = invoiceFacts(db, from, to)
  return periods(from, to, by).map((period) => {
    const f = facts.filter((x) => periodOf(x.issued_on, by) === period)
    const gross = f.reduce((t, x) => t + x.net_sales + x.shipping, 0)
    const taxable = f.reduce((t, x) => t + x.taxable, 0)
    const exempt = f.filter((x) => x.exempt).reduce((t, x) => t + x.net_sales + x.shipping, 0)
    return {
      period,
      invoices: f.length,
      gross_sales_cents: gross,
      taxable_sales_cents: taxable,
      exempt_sales_cents: exempt,
      nontaxable_sales_cents: Math.max(0, gross - taxable - exempt),
      tax_cents: f.reduce((t, x) => t + x.tax, 0)
    }
  })
}

export function paymentsByMethod(db: DB, from: string, to: string): PaymentsByMethodRow[] {
  const rows = db
    .prepare(`SELECT method, COUNT(*) AS n, SUM(amount_cents) AS s FROM payments WHERE voided_at IS NULL AND received_on BETWEEN ? AND ? GROUP BY method`)
    .all(from, to) as { method: PaymentMethod; n: number; s: number }[]
  return PAYMENT_METHODS.map((m) => {
    const r = rows.find((x) => x.method === m)
    return { method: m, label: PAYMENT_METHOD_LABELS[m], payments: r?.n ?? 0, amount_cents: r?.s ?? 0 }
  }).filter((r) => r.payments > 0)
}

/** Quotes dated in range (latest revisions only). Win rate = approved ÷ decided (approved + declined + expired). */
export function winRate(db: DB, from: string, to: string, today: string): WinRateReport {
  const rows = db
    .prepare(`SELECT status, expires_on, total_cents FROM quotes WHERE status <> 'superseded' AND archived_at IS NULL AND issued_on BETWEEN ? AND ?`)
    .all(from, to) as { status: string; expires_on: string | null; total_cents: number }[]
  const out: WinRateReport = { quotes: rows.length, draft: 0, open: 0, approved: 0, declined: 0, expired: 0, approved_cents: 0, lost_cents: 0, open_cents: 0, win_rate_bp: null }
  for (const r of rows) {
    const status = r.status === 'sent' && r.expires_on && r.expires_on < today ? 'expired' : r.status
    if (status === 'draft') out.draft++
    else if (status === 'sent') {
      out.open++
      out.open_cents += r.total_cents
    } else if (status === 'approved') {
      out.approved++
      out.approved_cents += r.total_cents
    } else if (status === 'declined' || status === 'expired') {
      out[status]++
      out.lost_cents += r.total_cents
    }
  }
  const decided = out.approved + out.declined + out.expired
  out.win_rate_bp = decided ? Math.round((out.approved * 10000) / decided) : null
  return out
}

const monthStart = (iso: string) => iso.slice(0, 8) + '01'
const monthEnd = (iso: string) => addDays(`${periodNext(iso.slice(0, 7))}-01`, -1)
function periodNext(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

export function dashboard(db: DB, today: string): DashboardSummary {
  const week = addDays(today, 7)
  const quote = (where: string, ...p: unknown[]) =>
    db
      .prepare(
        `SELECT q.id, q.number, q.job_name, q.total_cents, q.expires_on, q.sent_at, q.in_hands_on, c.company_name, c.first_name, c.last_name, q.customer_id
         FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id WHERE q.archived_at IS NULL AND ${where}`
      )
      .all(...p) as Array<Record<string, unknown>>
  const name = (r: Record<string, unknown>) => (r.customer_id ? customerDisplayName({ company_name: (r.company_name as string) ?? '', first_name: (r.first_name as string) ?? '', last_name: (r.last_name as string) ?? '' }) : '')

  const awaiting = quote(`q.status = 'sent' AND (q.expires_on IS NULL OR q.expires_on >= ?) ORDER BY q.sent_at`, today).map((r) => ({ id: r.id as number, number: r.number as string, customer: name(r), job_name: r.job_name as string, total_cents: r.total_cents as number, date: (r.expires_on as string) ?? null }))
  const expiring = awaiting.filter((q) => q.date && q.date <= week).sort((a, b) => (a.date! < b.date! ? -1 : 1))

  const invRows = db
    .prepare(
      `SELECT i.id, i.number, i.job_name, i.balance_cents, i.due_on, c.company_name, c.first_name, c.last_name, i.customer_id
       FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.archived_at IS NULL AND i.status IN ('sent', 'partially_paid') AND i.balance_cents > 0 ORDER BY i.due_on`
    )
    .all() as Array<Record<string, unknown>>
  const unpaid = invRows.map((r) => ({ id: r.id as number, number: r.number as string, customer: name(r), job_name: r.job_name as string, total_cents: r.balance_cents as number, date: (r.due_on as string) ?? null }))
  const overdue = unpaid.filter((i) => i.date && i.date < today)

  const thisMonth = [monthStart(today), monthEnd(today)] as const
  const lastMonthDay = addDays(monthStart(today), -1)
  const lastMonth = [monthStart(lastMonthDay), lastMonthDay] as const
  const net = (r: readonly [string, string]) => invoiceFacts(db, r[0], r[1]).reduce((t, x) => t + x.net_sales, 0)
  const collected = (r: readonly [string, string]) =>
    (db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS s FROM payments WHERE voided_at IS NULL AND received_on BETWEEN ? AND ?`).get(r[0], r[1]) as { s: number }).s

  // Jobs with an in-hands date in the next two weeks (or already past) that aren't finished.
  const jobs = db
    .prepare(
      `SELECT 'invoice' AS kind, i.id, i.number, i.job_name, i.in_hands_on, i.production_status, c.company_name, c.first_name, c.last_name, i.customer_id
         FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
         WHERE i.archived_at IS NULL AND i.status <> 'void' AND i.in_hands_on IS NOT NULL AND i.in_hands_on <= ? AND COALESCE(i.production_status, '') <> 'done'
       UNION ALL
       SELECT 'quote', q.id, q.number, q.job_name, q.in_hands_on, q.production_status, c.company_name, c.first_name, c.last_name, q.customer_id
         FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id
         WHERE q.archived_at IS NULL AND q.status = 'approved' AND q.converted_invoice_id IS NULL AND q.in_hands_on IS NOT NULL AND q.in_hands_on <= ? AND COALESCE(q.production_status, '') <> 'done'
       ORDER BY in_hands_on`
    )
    .all(addDays(today, 14), addDays(today, 14)) as Array<Record<string, unknown>>

  const sum = (xs: { total_cents: number }[]) => xs.reduce((t, x) => t + x.total_cents, 0)
  return {
    awaiting: { count: awaiting.length, total_cents: sum(awaiting), items: awaiting.slice(0, 6) },
    expiring: { count: expiring.length, total_cents: sum(expiring), items: expiring.slice(0, 6) },
    outstanding: { count: unpaid.length, total_cents: sum(unpaid), items: unpaid.slice(0, 6) },
    overdue: { count: overdue.length, total_cents: sum(overdue), items: overdue.slice(0, 6) },
    sales: { this_month_cents: net(thisMonth), last_month_cents: net(lastMonth), collected_this_month_cents: collected(thisMonth), collected_last_month_cents: collected(lastMonth) },
    in_hands: jobs.map((r) => ({ kind: r.kind as 'quote' | 'invoice', id: r.id as number, number: r.number as string, customer: name(r), job_name: r.job_name as string, in_hands_on: r.in_hands_on as string, production_status: (r.production_status as string) ?? null }))
  }
}
