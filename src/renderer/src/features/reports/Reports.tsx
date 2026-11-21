import * as Tabs from '@radix-ui/react-tabs'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { csvMoney, toCsv } from '@shared/csv'
import { addDays, todayIso } from '@shared/dates'
import { bpToPercentString, formatMoney } from '@shared/money'
import type { ReportRange } from '@shared/reports'
import { useAsync, useToast } from '../../components/toast'
import { Button, Card, EmptyState, Input, Loading, Notice, PageHeader, Select, Table, Td, Th } from '../../components/ui'
import { api } from '../../lib/api'
import { TabList } from '../pricing/PricingPage'

const TABS = [
  { id: 'sales', label: 'Sales by month' },
  { id: 'customers', label: 'Sales by customer' },
  { id: 'tax', label: 'Sales tax' },
  { id: 'payments', label: 'Payments by method' },
  { id: 'quotes', label: 'Quote win rate' }
]

function presets(today: string): { id: string; label: string; from: string; to: string }[] {
  const [y, m] = today.split('-').map(Number)
  const iso = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  const monthEnd = (yy: number, mm: number) => addDays(mm === 12 ? iso(yy + 1, 1, 1) : iso(yy, mm + 1, 1), -1)
  const q = Math.ceil(m / 3)
  const lq = q === 1 ? { y: y - 1, q: 4 } : { y, q: q - 1 }
  const lm = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
  return [
    { id: 'this_month', label: 'This month', from: iso(y, m, 1), to: monthEnd(y, m) },
    { id: 'last_month', label: 'Last month', from: iso(lm.y, lm.m, 1), to: monthEnd(lm.y, lm.m) },
    { id: 'this_quarter', label: 'This quarter', from: iso(y, q * 3 - 2, 1), to: monthEnd(y, q * 3) },
    { id: 'last_quarter', label: 'Last quarter', from: iso(lq.y, lq.q * 3 - 2, 1), to: monthEnd(lq.y, lq.q * 3) },
    { id: 'this_year', label: 'This year', from: iso(y, 1, 1), to: iso(y, 12, 31) },
    { id: 'last_year', label: 'Last year', from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31) },
    { id: 'last_12', label: 'Last 12 months', from: iso(m === 12 ? y : y - 1, (m % 12) + 1, 1), to: monthEnd(y, m) }
  ]
}

function ExportButton({ name, csv }: { name: string; csv: () => string }) {
  const run = useAsync()
  const toast = useToast()
  return (
    <Button
      size="sm"
      icon={<FileSpreadsheet className="size-3.5" />}
      onClick={() =>
        run(async () => {
          const p = await api.reports.exportCsv(name, csv())
          if (p) toast.success(`Saved ${p.split(/[\\/]/).pop()}`)
        })
      }
    >
      Export CSV
    </Button>
  )
}

function ReportTable({ head, rows, foot }: { head: ReactNode[]; rows: ReactNode[][]; foot?: ReactNode[] }) {
  return (
    <Table>
      <thead>
        <tr>
          {head.map((h, i) => (
            <Th key={i} className={i ? 'text-right' : ''}>
              {h}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <Td key={j} className={j ? 'text-right tabular' : ''}>
                {c}
              </Td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot && (
        <tfoot>
          <tr className="font-semibold">
            {foot.map((c, j) => (
              <Td key={j} className={j ? 'text-right tabular' : ''}>
                {c}
              </Td>
            ))}
          </tr>
        </tfoot>
      )}
    </Table>
  )
}

const m = (c: number) => formatMoney(c)
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0)
const label = (p: string) => (/^\d{4}-\d{2}$/.test(p) ? new Date(Number(p.slice(0, 4)), Number(p.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : p.replace('-', ' '))

export function ReportsPage() {
  const tab = useParams().tab ?? 'sales'
  const navigate = useNavigate()
  const today = todayIso()
  const ps = presets(today)
  const [preset, setPreset] = useState('this_year')
  const [custom, setCustom] = useState({ from: ps[4].from, to: ps[4].to })
  const [by, setBy] = useState<'month' | 'quarter'>('month')
  const p = ps.find((x) => x.id === preset)
  const range: ReportRange = { from: p ? p.from : custom.from, to: p ? p.to : custom.to, by }
  const suffix = `${range.from} to ${range.to}`
  const q = <T,>(name: string, fn: (r: ReportRange) => Promise<T>) =>
    useQuery({ queryKey: ['report', name, range], queryFn: () => fn(range), enabled: tab === name, staleTime: 0, retry: false })
  const sales = q('sales', api.reports.sales)
  const customers = q('customers', api.reports.byCustomer)
  const tax = q('tax', api.reports.salesTax)
  const payments = q('payments', api.reports.payments)
  const quotes = q('quotes', api.reports.winRate)

  const error = [sales, customers, tax, payments, quotes].find((x) => x.error)?.error

  return (
    <>
      <PageHeader title="Reports" subtitle="Sales count issued invoices (not drafts or void) by invoice date. Payments count by the date received." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select className="w-44" value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Date range">
          {ps.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
          <option value="custom">Custom dates…</option>
        </Select>
        {preset === 'custom' ? (
          <>
            <Input type="date" className="w-40" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From" />
            <span className="text-sm text-slate-500">to</span>
            <Input type="date" className="w-40" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To" />
          </>
        ) : (
          <span className="text-sm text-slate-500">
            {range.from} to {range.to}
          </span>
        )}
        {(tab === 'sales' || tab === 'tax') && (
          <Select className="w-36" value={by} onChange={(e) => setBy(e.target.value as 'month' | 'quarter')} aria-label="Group by">
            <option value="month">By month</option>
            <option value="quarter">By quarter</option>
          </Select>
        )}
      </div>
      {error && <Notice tone="red">{String((error as Error).message)}</Notice>}
      <Tabs.Root value={tab} onValueChange={(t) => navigate(`/reports/${t}`, { replace: true })}>
        <TabList tabs={TABS} />

        <Tabs.Content value="sales">
          {!sales.data ? (
            <Loading />
          ) : (
            <Card title="Sales" actions={<ExportButton name={`Sales by ${by} ${suffix}`} csv={() => toCsv(['Period', 'Invoices', 'Net sales', 'Sales tax', 'Shipping', 'Total invoiced', 'Collected'], sales.data!.map((r) => [r.period, r.invoices, csvMoney(r.net_sales_cents), csvMoney(r.tax_cents), csvMoney(r.shipping_cents), csvMoney(r.total_cents), csvMoney(r.collected_cents)]))} />} bodyClassName="p-0">
              <ReportTable
                head={['Period', 'Invoices', 'Net sales', 'Sales tax', 'Shipping', 'Total invoiced', 'Collected']}
                rows={sales.data.map((r) => [label(r.period), r.invoices, m(r.net_sales_cents), m(r.tax_cents), m(r.shipping_cents), m(r.total_cents), m(r.collected_cents)])}
                foot={['Total', sum(sales.data, (r) => r.invoices), m(sum(sales.data, (r) => r.net_sales_cents)), m(sum(sales.data, (r) => r.tax_cents)), m(sum(sales.data, (r) => r.shipping_cents)), m(sum(sales.data, (r) => r.total_cents)), m(sum(sales.data, (r) => r.collected_cents))]}
              />
            </Card>
          )}
        </Tabs.Content>

        <Tabs.Content value="customers">
          {!customers.data ? (
            <Loading />
          ) : !customers.data.length ? (
            <EmptyState title="No invoiced sales in this range" />
          ) : (
            <Card title="Sales by customer" actions={<ExportButton name={`Sales by customer ${suffix}`} csv={() => toCsv(['Customer', 'Invoices', 'Net sales', 'Sales tax', 'Total invoiced', 'Paid', 'Balance'], customers.data!.map((r) => [r.customer, r.invoices, csvMoney(r.net_sales_cents), csvMoney(r.tax_cents), csvMoney(r.total_cents), csvMoney(r.paid_cents), csvMoney(r.balance_cents)]))} />} bodyClassName="p-0">
              <ReportTable
                head={['Customer', 'Invoices', 'Net sales', 'Sales tax', 'Total invoiced', 'Paid', 'Balance']}
                rows={customers.data.map((r) => [r.customer_id ? <Link className="hover:underline" to={`/customers/${r.customer_id}`}>{r.customer}</Link> : r.customer, r.invoices, m(r.net_sales_cents), m(r.tax_cents), m(r.total_cents), m(r.paid_cents), m(r.balance_cents)])}
                foot={['Total', sum(customers.data, (r) => r.invoices), m(sum(customers.data, (r) => r.net_sales_cents)), m(sum(customers.data, (r) => r.tax_cents)), m(sum(customers.data, (r) => r.total_cents)), m(sum(customers.data, (r) => r.paid_cents)), m(sum(customers.data, (r) => r.balance_cents))]}
              />
            </Card>
          )}
        </Tabs.Content>

        <Tabs.Content value="tax">
          {!tax.data ? (
            <Loading />
          ) : (
            <Card
              title="Sales tax"
              actions={<ExportButton name={`Sales tax by ${by} ${suffix}`} csv={() => toCsv(['Period', 'Invoices', 'Gross sales', 'Taxable sales', 'Exempt sales', 'Non-taxable sales', 'Sales tax charged'], tax.data!.map((r) => [r.period, r.invoices, csvMoney(r.gross_sales_cents), csvMoney(r.taxable_sales_cents), csvMoney(r.exempt_sales_cents), csvMoney(r.nontaxable_sales_cents), csvMoney(r.tax_cents)]))} />}
              bodyClassName="p-0"
            >
              <ReportTable
                head={['Period', 'Invoices', 'Gross sales', 'Taxable sales', 'Exempt sales', 'Non-taxable', 'Tax charged']}
                rows={tax.data.map((r) => [label(r.period), r.invoices, m(r.gross_sales_cents), m(r.taxable_sales_cents), m(r.exempt_sales_cents), m(r.nontaxable_sales_cents), m(r.tax_cents)])}
                foot={['Total', sum(tax.data, (r) => r.invoices), m(sum(tax.data, (r) => r.gross_sales_cents)), m(sum(tax.data, (r) => r.taxable_sales_cents)), m(sum(tax.data, (r) => r.exempt_sales_cents)), m(sum(tax.data, (r) => r.nontaxable_sales_cents)), m(sum(tax.data, (r) => r.tax_cents))]}
              />
              <p className="px-4 py-3 text-xs text-slate-500">
                Gross = sales before tax plus shipping. Exempt = sales to tax-exempt customers. Non-taxable = items, fees or shipping marked not taxable. Tax is counted on the invoice date (accrual); check your state’s rules if you file on a cash basis.
              </p>
            </Card>
          )}
        </Tabs.Content>

        <Tabs.Content value="payments">
          {!payments.data ? (
            <Loading />
          ) : !payments.data.length ? (
            <EmptyState title="No payments received in this range" />
          ) : (
            <Card title="Payments by method" actions={<ExportButton name={`Payments by method ${suffix}`} csv={() => toCsv(['Method', 'Payments', 'Amount'], payments.data!.map((r) => [r.label, r.payments, csvMoney(r.amount_cents)]))} />} bodyClassName="p-0">
              <ReportTable head={['Method', 'Payments', 'Amount']} rows={payments.data.map((r) => [r.label, r.payments, m(r.amount_cents)])} foot={['Total', sum(payments.data, (r) => r.payments), m(sum(payments.data, (r) => r.amount_cents))]} />
            </Card>
          )}
        </Tabs.Content>

        <Tabs.Content value="quotes">
          {!quotes.data ? (
            <Loading />
          ) : (
            <Card
              title="Quote win rate"
              actions={
                <ExportButton
                  name={`Quote win rate ${suffix}`}
                  csv={() => {
                    const r = quotes.data!
                    return toCsv(['Quotes', 'Approved', 'Declined', 'Expired', 'Still open', 'Drafts', 'Win rate %', 'Approved value', 'Lost value', 'Open value'], [[r.quotes, r.approved, r.declined, r.expired, r.open, r.draft, r.win_rate_bp == null ? '' : bpToPercentString(r.win_rate_bp), csvMoney(r.approved_cents), csvMoney(r.lost_cents), csvMoney(r.open_cents)]])
                  }}
                />
              }
            >
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-slate-500">Win rate</div>
                  <div className="text-3xl font-semibold tabular">{quotes.data.win_rate_bp == null ? '–' : `${bpToPercentString(quotes.data.win_rate_bp)}%`}</div>
                  <div className="text-xs text-slate-500">approved ÷ (approved + declined + expired)</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Approved</div>
                  <div className="text-xl font-semibold tabular">{quotes.data.approved}</div>
                  <div className="text-xs text-slate-500">{m(quotes.data.approved_cents)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Declined / expired</div>
                  <div className="text-xl font-semibold tabular">
                    {quotes.data.declined} / {quotes.data.expired}
                  </div>
                  <div className="text-xs text-slate-500">{m(quotes.data.lost_cents)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Still open / drafts</div>
                  <div className="text-xl font-semibold tabular">
                    {quotes.data.open} / {quotes.data.draft}
                  </div>
                  <div className="text-xs text-slate-500">{m(quotes.data.open_cents)} open</div>
                </div>
              </div>
              <p className="mt-4 text-xs text-slate-500">Counts quotes dated in the range, latest revision only.</p>
            </Card>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </>
  )
}
