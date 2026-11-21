import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Layers, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { SeparationJob } from '@shared/separations/job'
import { useAsync } from '../../components/toast'
import { Badge, Button, ConfirmDialog, cx, EmptyState, Loading, PageHeader, Table, Td, Th } from '../../components/ui'
import { api } from '../../lib/api'

export function SeparationsList() {
  const { data, isLoading } = useQuery({ queryKey: ['separations'], queryFn: () => api.separations.list(), staleTime: 0, refetchOnMount: 'always' })
  const tools = useQuery({ queryKey: ['sep-tools'], queryFn: () => api.separations.tools(), staleTime: Infinity })
  const navigate = useNavigate()
  const run = useAsync()
  const qc = useQueryClient()
  const [over, setOver] = useState(false)
  const [deleting, setDeleting] = useState<SeparationJob | null>(null)
  const open = async (paths: string[] | null) => {
    const j = await run(() => api.separations.fromFile(paths))
    if (j) navigate(`/separations/${j.id}`)
  }
  return (
    <>
      <PageHeader
        title="Separations"
        subtitle="Spot-color film positives from vector art (SVG, PDF, AI; EPS with Inkscape or Ghostscript installed). One film per screen, at actual size."
        actions={
          <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => open(null)}>
            Open artwork…
          </Button>
        }
      />
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const p = [...e.dataTransfer.files].map((f) => window.files.pathFor(f)).filter(Boolean)
          if (p.length) void open(p)
        }}
        className={cx('mb-5 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm text-slate-500 transition', over ? 'border-accent bg-accent/5' : 'border-slate-300 dark:border-slate-700')}
      >
        Drop an SVG, PDF or AI file here to start a separation.
        {tools.data && !tools.data.inkscape && !tools.data.ghostscript && <span className="block text-xs">EPS needs Inkscape or Ghostscript installed; otherwise re-save EPS art as PDF or SVG.</span>}
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState icon={<Layers className="size-8" />} title="No separations yet">
          You can also start one from an artwork file on a quote or invoice (Mockups &amp; artwork → Separate).
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th />
              <Th>Name</Th>
              <Th>Art file</Th>
              <Th>Linked to</Th>
              <Th className="text-right">Screens</Th>
              <Th className="text-right">Updated</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((j) => (
              <tr key={j.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => navigate(`/separations/${j.id}`)}>
                <Td className="w-16">{j.thumbnail_url ? <img src={j.thumbnail_url} alt="" className="size-12 rounded object-contain" /> : <Layers className="size-6 text-slate-300" />}</Td>
                <Td className="font-medium">{j.name || j.source_name}</Td>
                <Td className="text-slate-500">
                  {j.source_name} <Badge>{j.source_kind.toUpperCase()}</Badge>
                </Td>
                <Td>
                  {j.owner_number ? (
                    <Link to={`/${j.owner_type === 'quote' ? 'quotes' : 'invoices'}/${j.owner_id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                      {j.owner_number}
                    </Link>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </Td>
                <Td className="text-right tabular">{j.plate_count ? `${j.ink_count}${j.has_underbase ? ' + UB' : ''}` : '—'}</Td>
                <Td className="text-right text-xs text-slate-500">{new Date(j.updated_at).toLocaleDateString()}</Td>
                <Td className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${j.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleting(j)
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this separation?"
        danger
        confirmLabel="Delete"
        onConfirm={async () => {
          await run(async () => {
            await api.separations.remove(deleting!.id)
            await qc.invalidateQueries({ queryKey: ['separations'] })
          }, 'Separation deleted')
        }}
      >
        Its settings are removed and any imprint linked to it keeps its colors but loses the link. Films you already saved, and artwork attached to quotes or invoices, are kept.
      </ConfirmDialog>
    </>
  )
}
