import { useQuery } from '@tanstack/react-query'
import { Plus, Receipt } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { formatDate, todayIso } from '@shared/dates'
import { INVOICE_STATUS_LABELS, INVOICE_STATUSES, invoiceDisplayStatus } from '@shared/invoice'
import type { InvoiceFilter } from '@shared/ipc'
import { formatMoney } from '@shared/money'
import { useToast } from '../../components/toast'
import { Button, Checkbox, cx, EmptyState, Input, Loading, PageHeader, Select, Table, Td, Th } from '../../components/ui'
import { api } from '../../lib/api'
import { useCustomers, useInvalidate } from '../../lib/queries'
import { InvoiceStatusBadge } from './status'

export function useNewInvoice() {
  const navigate = useNavigate()
  const toast = useToast()
  const invalidate = useInvalidate()
  return async (customerId?: number) => {
    try {
      const inv = await api.invoices.create({ customer_id: customerId ?? null })
      void invalidate('invoices', 'customers', 'customer')
      navigate(`/invoices/${inv.id}`)
    } catch (e) {
      toast.error(e)
    }
  }
}

export function InvoicesList() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [archived, setArchived] = useState(false)
  const status = (params.get('status') ?? '') as InvoiceFilter['status'] | ''
  const customerId = Number(params.get('customer') ?? 0) || undefined
  const filter: InvoiceFilter = { status: status || undefined, customer_id: customerId, from: from || undefined, to: to || undefined, search: search || undefined, includeArchived: archived }
  const { data, isLoading } = useQuery({ queryKey: ['invoices', filter], queryFn: () => api.invoices.list(filter), staleTime: 0, refetchOnMount: 'always' })
  const customers = useCustomers({})
  const navigate = useNavigate()
  const newInvoice = useNewInvoice()
  const today = todayIso()
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
  }
  const filtering = !!(status || customerId || from || to || search)
  const totals = (data ?? []).filter((i) => i.status !== 'void' && i.status !== 'draft').reduce((t, i) => ({ total: t.total + i.total_cents, balance: t.balance + i.balance_cents }), { total: 0, balance: 0 })

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle={data?.length ? `${formatMoney(totals.balance)} outstanding across the invoices shown` : undefined}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => newInvoice(customerId)}>
            New invoice
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="max-w-60" placeholder="Number, job, PO, customer…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search invoices" />
        <Select className="w-44" value={status} onChange={(e) => setParam('status', e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="unpaid">Unpaid (sent or partly paid)</option>
          <option value="overdue">Overdue</option>
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {INVOICE_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select className="w-52" value={customerId ?? ''} onChange={(e) => setParam('customer', e.target.value)} aria-label="Customer">
          <option value="">All customers</option>
          {(customers.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.display_name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          From
          <Input type="date" className="w-36" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          to
          <Input type="date" className="w-36" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </label>
        <Checkbox checked={archived} onChange={setArchived} label="Show archived" />
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState icon={<Receipt className="size-8" />} title={filtering ? 'No invoices match' : 'No invoices yet'} action={!filtering && <Button onClick={() => navigate('/quotes?status=approved')}>See approved quotes</Button>}>
          {filtering ? 'Try different filters.' : 'Convert an approved quote with one click, or start a blank invoice.'}
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Customer</Th>
              <Th>Job</Th>
              <Th>Status</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Paid</Th>
              <Th className="text-right">Balance</Th>
              <Th className="text-right">Date</Th>
              <Th className="text-right">Due</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((i) => {
              const st = invoiceDisplayStatus(i, today)
              return (
                <tr key={i.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => navigate(`/invoices/${i.id}`)}>
                  <Td className="font-medium whitespace-nowrap">
                    {i.number}
                    {i.archived_at && <span className="ml-1 text-xs font-normal text-slate-500">(archived)</span>}
                  </Td>
                  <Td>{i.customer_name || <span className="text-slate-400">No customer</span>}</Td>
                  <Td className="max-w-48 truncate">{i.job_name}</Td>
                  <Td>
                    <InvoiceStatusBadge status={st} />
                  </Td>
                  <Td className="text-right tabular">{formatMoney(i.total_cents)}</Td>
                  <Td className="text-right text-slate-600 tabular dark:text-slate-400">{formatMoney(i.paid_cents)}</Td>
                  <Td className={cx('text-right font-medium tabular', i.status !== 'void' && i.balance_cents > 0 && 'text-slate-900 dark:text-white')}>{i.status === 'void' ? '–' : formatMoney(i.balance_cents)}</Td>
                  <Td className="text-right whitespace-nowrap text-slate-600 tabular dark:text-slate-400">{formatDate(i.issued_on)}</Td>
                  <Td className={cx('text-right whitespace-nowrap tabular', st === 'overdue' ? 'font-medium text-red-600' : 'text-slate-600 dark:text-slate-400')}>{formatDate(i.due_on)}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </>
  )
}
