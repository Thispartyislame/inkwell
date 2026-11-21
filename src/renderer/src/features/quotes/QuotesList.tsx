import { useQuery } from '@tanstack/react-query'
import { FileText, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { addDays, formatDate, todayIso } from '@shared/dates'
import type { QuoteFilter } from '@shared/ipc'
import { formatMoney } from '@shared/money'
import { effectiveStatus, QUOTE_STATUS_LABELS, QUOTE_STATUSES } from '@shared/quote'
import { useToast } from '../../components/toast'
import { Button, Checkbox, EmptyState, Input, Loading, PageHeader, Select, Table, Td, Th, cx } from '../../components/ui'
import { api } from '../../lib/api'
import { useCustomers, useInvalidate } from '../../lib/queries'
import { QuoteStatusBadge } from './status'

export function useNewQuote() {
  const navigate = useNavigate()
  const toast = useToast()
  const invalidate = useInvalidate()
  return async (customerId?: number) => {
    try {
      const q = await api.quotes.create({ customer_id: customerId ?? null })
      void invalidate('quotes', 'customers', 'customer')
      navigate(`/quotes/${q.id}`)
    } catch (e) {
      toast.error(e)
    }
  }
}

export function QuotesList() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [archived, setArchived] = useState(false)
  const status = (params.get('status') ?? '') as QuoteFilter['status'] | ''
  const customerId = Number(params.get('customer') ?? 0) || undefined
  const filter: QuoteFilter = { status: status || undefined, customer_id: customerId, from: from || undefined, to: to || undefined, search: search || undefined, includeArchived: archived }
  const { data, isLoading } = useQuery({ queryKey: ['quotes', filter], queryFn: () => api.quotes.list(filter), staleTime: 0, refetchOnMount: 'always' })
  const customers = useCustomers({})
  const navigate = useNavigate()
  const newQuote = useNewQuote()
  const today = todayIso()
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
  }
  const filtering = !!(status || customerId || from || to || search)

  return (
    <>
      <PageHeader
        title="Quotes"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => newQuote(customerId)}>
            New quote
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="max-w-60" placeholder="Number, job, customer…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search quotes" />
        <Select className="w-40" value={status} onChange={(e) => setParam('status', e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="open">Open (draft or sent)</option>
          {QUOTE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {QUOTE_STATUS_LABELS[s]}
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
        <EmptyState icon={<FileText className="size-8" />} title={filtering ? 'No quotes match' : 'No quotes yet'} action={!filtering && <Button variant="primary" onClick={() => newQuote()}>Create your first quote</Button>}>
          {filtering ? 'Try different filters.' : 'Quotes are priced live from your matrices and rules as you build them.'}
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
              <Th className="text-right">Date</Th>
              <Th className="text-right">Valid until</Th>
              <Th className="text-right">In hands</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((q) => {
              const st = effectiveStatus(q, today)
              const expiringSoon = st === 'sent' && q.expires_on && q.expires_on <= addDays(today, 7)
              return (
                <tr key={q.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => navigate(`/quotes/${q.id}`)}>
                  <Td className="font-medium whitespace-nowrap">
                    {q.number}
                    {q.archived_at && <span className="ml-1 text-xs font-normal text-slate-500">(archived)</span>}
                  </Td>
                  <Td>{q.customer_name || <span className="text-slate-400">No customer</span>}</Td>
                  <Td className="max-w-56 truncate">{q.job_name}</Td>
                  <Td>
                    <QuoteStatusBadge status={st} />
                  </Td>
                  <Td className="text-right font-medium tabular">{formatMoney(q.total_cents)}</Td>
                  <Td className="text-right whitespace-nowrap text-slate-600 tabular dark:text-slate-400">{formatDate(q.issued_on)}</Td>
                  <Td className={cx('text-right whitespace-nowrap tabular', expiringSoon ? 'font-medium text-amber-600' : 'text-slate-600 dark:text-slate-400')}>{formatDate(q.expires_on)}</Td>
                  <Td className="text-right whitespace-nowrap text-slate-600 tabular dark:text-slate-400">{formatDate(q.in_hands_on)}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </>
  )
}
