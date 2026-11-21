import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, Clock, FileText, Plus, Receipt, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { addDays, formatDate, todayIso } from '@shared/dates'
import { formatMoney } from '@shared/money'
import { isProductionStatus, PRODUCTION_LABELS } from '@shared/production'
import type { DashboardItem } from '@shared/reports'
import { Badge, Button, Card, cx, Loading, PageHeader } from '../../components/ui'
import { api } from '../../lib/api'
import { useSettings } from '../../lib/queries'
import { useNewInvoice } from '../invoices/InvoicesList'
import { useNewQuote } from '../quotes/QuotesList'

function Change({ now, before }: { now: number; before: number }) {
  if (!before) return null
  const pct = Math.round(((now - before) / before) * 100)
  return <span className={cx('text-xs font-medium', pct >= 0 ? 'text-emerald-600' : 'text-red-600')}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}% vs last month</span>
}

function Stat({ icon, label, value, sub, to, tone }: { icon: ReactNode; label: string; value: string; sub?: ReactNode; to: string; tone?: 'red' | 'amber' }) {
  return (
    <Link to={to} className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-4 transition hover:border-accent dark:border-slate-800 dark:bg-slate-900">
      <span className={cx('flex items-center gap-2 text-xs font-medium', tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-500')}>
        {icon}
        {label}
      </span>
      <span className="text-2xl font-semibold tabular">{value}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </Link>
  )
}

function ItemList({ items, base, dateLabel, empty, dateTone }: { items: DashboardItem[]; base: string; dateLabel: string; empty: string; dateTone?: (d: string) => string }) {
  if (!items.length) return <p className="text-sm text-slate-500">{empty}</p>
  return (
    <ul className="-mx-2 flex flex-col">
      {items.map((i) => (
        <li key={i.id}>
          <Link to={`${base}/${i.id}`} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
            <span className="w-24 shrink-0 font-medium">{i.number}</span>
            <span className="min-w-0 flex-1 truncate">
              {i.customer || '—'}
              {i.job_name && <span className="text-slate-500"> · {i.job_name}</span>}
            </span>
            {i.date && (
              <span className={cx('shrink-0 text-xs', dateTone?.(i.date) ?? 'text-slate-500')}>
                {dateLabel} {formatDate(i.date)}
              </span>
            )}
            <span className="w-24 shrink-0 text-right tabular">{formatMoney(i.total_cents)}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function GettingStarted() {
  const { data: s } = useSettings()
  const steps: [string, string, boolean][] = [
    ['Shop details and logo', '/settings', !!s?.logo_path],
    ['Make the sample pricing your own', '/pricing', false],
    ['Add your garments or import a supplier CSV', '/catalog', false],
    ['Set up email for sending quotes and invoices', '/settings/email', !!s?.smtp_password_set],
    ['Add a customer and build your first quote', '/quotes', false]
  ]
  return (
    <Card title="Getting started" className="mb-5">
      <ol className="grid grid-cols-5 gap-3 text-sm">
        {steps.map(([label, to, done], i) => (
          <li key={to + i}>
            <Link to={to} className={cx('flex h-full flex-col gap-1 rounded-md border border-slate-200 p-3 hover:border-accent dark:border-slate-700', done && 'opacity-60')}>
              <span className="text-xs font-semibold text-accent">{done ? '✓' : i + 1}</span>
              {label}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  )
}

export function Dashboard() {
  const { data: s } = useSettings()
  const { data: d, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.reports.dashboard(), staleTime: 0, refetchOnMount: 'always' })
  const newQuote = useNewQuote()
  const newInvoice = useNewInvoice()
  const navigate = useNavigate()
  const today = todayIso()
  const anyQuotes = useQuery({ queryKey: ['quotes', 'any'], queryFn: () => api.quotes.list({ includeArchived: true, includeSuperseded: true }), staleTime: 0 })
  const firstRun = anyQuotes.data?.length === 0
  if (isLoading || !d) return <Loading />
  return (
    <>
      <PageHeader
        title={s?.shop_name || 'Dashboard'}
        subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        actions={
          <>
            <Button icon={<Plus className="size-4" />} onClick={() => newInvoice()}>
              New invoice
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => newQuote()}>
              New quote
            </Button>
          </>
        }
      />
      <div className="mb-5 grid grid-cols-4 gap-4">
        <Stat icon={<FileText className="size-4" />} label="Quotes awaiting response" value={String(d.awaiting.count)} sub={`${formatMoney(d.awaiting.total_cents)} quoted`} to="/quotes?status=sent" />
        <Stat icon={<Wallet className="size-4" />} label="Outstanding balance" value={formatMoney(d.outstanding.total_cents)} sub={`${d.outstanding.count} unpaid invoice${d.outstanding.count === 1 ? '' : 's'}`} to="/invoices?status=unpaid" />
        <Stat icon={<AlertTriangle className="size-4" />} label="Overdue" value={formatMoney(d.overdue.total_cents)} sub={`${d.overdue.count} invoice${d.overdue.count === 1 ? '' : 's'} past due`} to="/invoices?status=overdue" tone={d.overdue.count ? 'red' : undefined} />
        <Stat icon={<Receipt className="size-4" />} label="Sales this month" value={formatMoney(d.sales.this_month_cents)} sub={<Change now={d.sales.this_month_cents} before={d.sales.last_month_cents} />} to="/reports" />
      </div>

      {firstRun && <GettingStarted />}

      <div className="grid grid-cols-2 gap-5">
        <Card title="Quotes expiring this week" actions={<Link to="/quotes?status=sent" className="text-xs text-slate-500 hover:underline">All sent quotes</Link>}>
          <ItemList items={d.expiring.items} base="/quotes" dateLabel="expires" empty="Nothing expiring in the next 7 days." dateTone={() => 'text-amber-600'} />
        </Card>
        <Card title="Overdue invoices" actions={<Link to="/invoices?status=overdue" className="text-xs text-slate-500 hover:underline">All overdue</Link>}>
          <ItemList items={d.overdue.items} base="/invoices" dateLabel="due" empty="Nothing overdue." dateTone={() => 'font-medium text-red-600'} />
        </Card>
        <Card title="Upcoming in-hands dates" actions={<Link to="/production" className="text-xs text-slate-500 hover:underline">Production board</Link>}>
          {!d.in_hands.length ? (
            <p className="text-sm text-slate-500">No jobs due in the next two weeks.</p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {d.in_hands.map((j) => {
                const late = j.in_hands_on < today
                const soon = !late && j.in_hands_on <= addDays(today, 3)
                return (
                  <li key={`${j.kind}${j.id}`}>
                    <button type="button" onClick={() => navigate(`/${j.kind === 'quote' ? 'quotes' : 'invoices'}/${j.id}`)} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                      <CalendarClock className={cx('size-4 shrink-0', late ? 'text-red-600' : soon ? 'text-amber-600' : 'text-slate-400')} />
                      <span className={cx('w-24 shrink-0 text-xs', late ? 'font-semibold text-red-600' : soon ? 'font-semibold text-amber-600' : 'text-slate-500')}>{formatDate(j.in_hands_on)}</span>
                      <span className="w-24 shrink-0 font-medium">{j.number}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {j.customer}
                        {j.job_name && <span className="text-slate-500"> · {j.job_name}</span>}
                      </span>
                      {isProductionStatus(j.production_status) && <Badge>{PRODUCTION_LABELS[j.production_status]}</Badge>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
        <Card title="This month vs last month">
          <table className="w-full text-sm tabular">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-1 font-medium" />
                <th className="pb-1 text-right font-medium">This month</th>
                <th className="pb-1 text-right font-medium">Last month</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1.5">Sales invoiced (before tax)</td>
                <td className="py-1.5 text-right font-semibold">{formatMoney(d.sales.this_month_cents)}</td>
                <td className="py-1.5 text-right">{formatMoney(d.sales.last_month_cents)}</td>
              </tr>
              <tr className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1.5">Payments collected</td>
                <td className="py-1.5 text-right font-semibold">{formatMoney(d.sales.collected_this_month_cents)}</td>
                <td className="py-1.5 text-right">{formatMoney(d.sales.collected_last_month_cents)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
            <Clock className="size-3.5" /> Sales count invoices by invoice date; collections count payments by the date received.
          </p>
        </Card>
      </div>
    </>
  )
}
