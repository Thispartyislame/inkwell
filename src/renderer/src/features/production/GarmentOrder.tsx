import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Check, FileDown, FileSpreadsheet, FileText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { csvMoney, toCsv } from '@shared/csv'
import { todayIso } from '@shared/dates'
import { formatMoney } from '@shared/money'
import { NEEDS_GARMENTS, PRODUCTION_LABELS, type BoardJob, type GarmentOrder, type JobRef } from '@shared/production'
import { useAsync } from '../../components/toast'
import { Button, Card, Checkbox, EmptyState, Loading, Notice, PageHeader, Table, Td, Th } from '../../components/ui'
import { api } from '../../lib/api'
import { useInvalidate } from '../../lib/queries'

const key = (j: JobRef) => `${j.kind}:${j.id}`

export function orderCsv(o: GarmentOrder): string {
  return toCsv(
    ['Supplier', 'Brand', 'Style', 'Name', 'Color', ...o.size_columns, 'Total', 'Est. cost'],
    o.groups.flatMap((g) => g.items.map((i) => [g.supplier, i.brand, i.style_number, i.name, i.color, ...o.size_columns.map((c) => i.sizes[c] ?? ''), i.total, csvMoney(i.est_cost_cents)]))
  )
}

export function GarmentOrderPage() {
  const board = useQuery({ queryKey: ['board'], queryFn: () => api.production.board(), staleTime: 0, refetchOnMount: 'always' })
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const run = useAsync()
  const invalidate = useInvalidate()
  const jobs = useMemo(() => (board.data ?? []).filter((j) => j.status !== 'done'), [board.data])
  useEffect(() => {
    if (board.data && selected === null) setSelected(new Set(jobs.filter((j) => NEEDS_GARMENTS.includes(j.status)).map(key)))
  }, [board.data, jobs, selected])
  const refs: JobRef[] = jobs.filter((j) => selected?.has(key(j))).map((j) => ({ kind: j.kind, id: j.id }))
  const order = useQuery({ queryKey: ['garment-order', refs.map(key).join(',')], queryFn: () => api.production.garmentOrder(refs), enabled: refs.length > 0, gcTime: 0 })
  const toggle = (j: BoardJob) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(key(j))) n.delete(key(j))
      else n.add(key(j))
      return n
    })

  if (board.isLoading) return <Loading />
  const o = refs.length ? order.data : undefined
  return (
    <>
      <PageHeader
        back={
          <Link to="/production" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-3" /> Production
          </Link>
        }
        title="Garment order list"
        subtitle="Blank garments for the selected jobs, combined by supplier, style, color and size."
        actions={
          o && (
            <>
              <Button icon={<FileSpreadsheet className="size-4" />} onClick={() => run(async () => void (await api.reports.exportCsv(`Garment order ${todayIso()}`, orderCsv(o))))}>
                Export CSV
              </Button>
              <Button icon={<FileText className="size-4" />} onClick={() => run(() => api.production.garmentOrderPdf(refs, 'open'))}>
                Open PDF
              </Button>
              <Button icon={<FileDown className="size-4" />} onClick={() => run(() => api.production.garmentOrderPdf(refs, 'save'))}>
                Save PDF
              </Button>
              <Button
                variant="primary"
                icon={<Check className="size-4" />}
                onClick={() =>
                  run(async () => {
                    await api.production.markOrdered(refs)
                    setSelected(new Set())
                    await invalidate('board', 'dashboard')
                  }, 'Jobs moved to “Garments ordered”')
                }
              >
                Mark as ordered
              </Button>
            </>
          )
        }
      />
      {!jobs.length ? (
        <EmptyState title="No open jobs">Approved quotes and invoices on the production board show up here.</EmptyState>
      ) : (
        <div className="grid grid-cols-[18rem_minmax(0,1fr)] items-start gap-5">
          <Card title={`Jobs (${refs.length} of ${jobs.length})`} bodyClassName="p-0">
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {jobs.map((j) => (
                <li key={key(j)} className="px-3 py-2">
                  <Checkbox
                    checked={!!selected?.has(key(j))}
                    onChange={() => toggle(j)}
                    label={
                      <span>
                        <span className="font-medium">{j.number}</span> · {j.customer}
                        <span className="block text-xs text-slate-500">
                          {j.pieces} pcs · {PRODUCTION_LABELS[j.status]}
                        </span>
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          </Card>
          <div className="flex flex-col gap-4">
            {!refs.length ? (
              <EmptyState title="Pick jobs on the left">Jobs still waiting on art or proofs are selected by default.</EmptyState>
            ) : order.isLoading || !o ? (
              <Loading />
            ) : (
              <>
                {o.skipped_customer_supplied > 0 && <Notice tone="blue">{o.skipped_customer_supplied} customer-supplied line(s) aren’t included.</Notice>}
                {o.groups.map((g) => (
                  <div key={g.supplier}>
                    <h2 className="mb-2 flex items-baseline justify-between text-sm font-semibold">
                      {g.supplier}
                      <span className="text-xs font-normal text-slate-500">
                        {g.total} pcs · est. {formatMoney(g.est_cost_cents)}
                      </span>
                    </h2>
                    <Table>
                      <thead>
                        <tr>
                          <Th>Style</Th>
                          <Th>Color</Th>
                          {o.size_columns.map((c) => (
                            <Th key={c} className="text-right">
                              {c}
                            </Th>
                          ))}
                          <Th className="text-right">Total</Th>
                          <Th className="text-right">Est. cost</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((i, n) => (
                          <tr key={n}>
                            <Td>
                              <div className="font-medium">{[i.brand, i.style_number].filter(Boolean).join(' ') || i.name}</div>
                              {(i.brand || i.style_number) && <div className="text-xs text-slate-500">{i.name}</div>}
                            </Td>
                            <Td>{i.color}</Td>
                            {o.size_columns.map((c) => (
                              <Td key={c} className="text-right tabular">
                                {i.sizes[c] ?? ''}
                              </Td>
                            ))}
                            <Td className="text-right font-semibold tabular">{i.total}</Td>
                            <Td className="text-right text-slate-600 tabular dark:text-slate-400">{formatMoney(i.est_cost_cents)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                ))}
                <p className="text-right text-sm font-semibold">
                  {o.total} pieces · est. {formatMoney(o.est_cost_cents)}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
