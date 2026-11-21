import { Archive, ArchiveRestore, Copy, Grid3x3, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { formatMoney } from '@shared/money'
import { COLUMN_KIND_LABELS, METHOD_LABELS } from '@shared/schemas'
import { useAsync } from '../../components/toast'
import { Badge, Button, Checkbox, EmptyState, Loading, SampleBadge, Table, Td, Th } from '../../components/ui'
import { api } from '../../lib/api'
import { useInvalidate, useMatrices } from '../../lib/queries'

export function MatricesTab() {
  const [archived, setArchived] = useState(false)
  const { data, isLoading } = useMatrices(archived)
  const navigate = useNavigate()
  const run = useAsync()
  const invalidate = useInvalidate()
  if (isLoading) return <Loading />
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-600 dark:text-slate-400">Price per piece, per print location, by quantity and number of colors (or stitches / print size).</p>
        <div className="flex items-center gap-3">
          <Checkbox checked={archived} onChange={setArchived} label="Show archived" />
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/pricing/matrices/new')}>
            New matrix
          </Button>
        </div>
      </div>
      {!data?.length ? (
        <EmptyState icon={<Grid3x3 className="size-8" />} title="No matrices" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Method</Th>
              <Th>Grid</Th>
              <Th className="text-right">Price range</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((m) => {
              const all = m.prices.flat()
              return (
                <tr key={m.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => navigate(`/pricing/matrices/${m.id}`)}>
                  <Td>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{m.name}</span>
                      {m.is_default && <Badge color="blue">Default</Badge>}
                      {m.is_sample && <SampleBadge />}
                      {m.archived_at && <Badge>Archived</Badge>}
                    </div>
                  </Td>
                  <Td>{METHOD_LABELS[m.method]}</Td>
                  <Td className="text-slate-600 dark:text-slate-400">
                    {m.breaks.length} quantity breaks × {m.columns.length} {COLUMN_KIND_LABELS[m.column_kind].toLowerCase()}
                  </Td>
                  <Td className="text-right tabular">{all.length ? `${formatMoney(Math.min(...all))} – ${formatMoney(Math.max(...all))}` : '–'}</Td>
                  <Td className="text-right whitespace-nowrap" >
                    <span onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" title="Duplicate" aria-label={`Duplicate ${m.name}`} onClick={() => run(async () => (await api.pricing.duplicateMatrix(m.id), invalidate('matrices')), 'Matrix duplicated')}>
                        <Copy className="size-3.5" />
                      </Button>
                      {m.archived_at ? (
                        <Button size="sm" variant="ghost" title="Restore" aria-label={`Restore ${m.name}`} onClick={() => run(async () => (await api.pricing.restoreMatrix(m.id), invalidate('matrices')), 'Matrix restored')}>
                          <ArchiveRestore className="size-3.5" />
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" title="Archive" aria-label={`Archive ${m.name}`} onClick={() => run(async () => (await api.pricing.archiveMatrix(m.id), invalidate('matrices')), 'Matrix archived (restore it with “Show archived”)')}>
                          <Archive className="size-3.5" />
                        </Button>
                      )}
                    </span>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </>
  )
}
