import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Package, Shirt } from 'lucide-react'
import { useNavigate } from 'react-router'
import { addDays, formatDate, todayIso } from '@shared/dates'
import { PRODUCTION_LABELS, PRODUCTION_STATUSES, type BoardJob, type ProductionStatus } from '@shared/production'
import { useToast } from '../../components/toast'
import { Button, cx, EmptyState, Loading, PageHeader, Select } from '../../components/ui'
import { api } from '../../lib/api'

const key = (j: BoardJob) => `${j.kind}:${j.id}`

function JobCard({ job, onMove }: { job: BoardJob; onMove: (s: ProductionStatus) => void }) {
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: key(job) })
  const today = todayIso()
  const late = job.in_hands_on && job.status !== 'done' && job.in_hands_on < today
  const soon = job.in_hands_on && job.status !== 'done' && !late && job.in_hands_on <= addDays(today, 3)
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cx(
        'cursor-grab rounded-md border border-slate-200 bg-white p-2.5 text-sm shadow-xs active:cursor-grabbing dark:border-slate-700 dark:bg-slate-900',
        isDragging && 'z-10 shadow-lg ring-2 ring-accent'
      )}
      aria-label={`${job.number} ${job.customer}`}
    >
      {job.thumbnail && <img src={job.thumbnail} alt="" className="mb-2 h-20 w-full rounded bg-slate-50 object-contain dark:bg-slate-800" />}
      <button type="button" className="block w-full text-left" onClick={() => navigate(`/${job.kind === 'quote' ? 'quotes' : 'invoices'}/${job.id}`)} onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold hover:underline">{job.number}</span>
          <span className="text-xs text-slate-500">{job.pieces} pcs</span>
        </div>
        <div className="truncate text-slate-700 dark:text-slate-300">{job.customer || 'No customer'}</div>
        {job.job_name && <div className="truncate text-xs text-slate-500">{job.job_name}</div>}
      </button>
      <div className="mt-2 flex items-center justify-between gap-2">
        {job.in_hands_on ? (
          <span className={cx('flex items-center gap-1 text-xs', late ? 'font-semibold text-red-600' : soon ? 'font-semibold text-amber-600' : 'text-slate-500')}>
            <CalendarClock className="size-3.5" />
            {formatDate(job.in_hands_on)}
          </span>
        ) : (
          <span className="text-xs text-slate-400">No in-hands date</span>
        )}
        <Select className="h-6 w-28 shrink-0 px-1 text-[11px]" value={job.status} aria-label={`Move ${job.number}`} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => onMove(e.target.value as ProductionStatus)}>
          {PRODUCTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PRODUCTION_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
}

function Column({ status, jobs, onMove }: { status: ProductionStatus; jobs: BoardJob[]; onMove: (j: BoardJob, s: ProductionStatus) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <section ref={setNodeRef} aria-label={PRODUCTION_LABELS[status]} className={cx('flex w-60 shrink-0 flex-col rounded-lg bg-slate-100 dark:bg-slate-900/60', isOver && 'ring-2 ring-accent')}>
      <header className="flex items-center justify-between px-3 py-2 text-xs font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-400">
        {PRODUCTION_LABELS[status]}
        <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800">{jobs.length}</span>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
        {jobs.map((j) => (
          <JobCard key={key(j)} job={j} onMove={(s) => onMove(j, s)} />
        ))}
      </div>
    </section>
  )
}

export function ProductionBoard() {
  const { data, isLoading } = useQuery({ queryKey: ['board'], queryFn: () => api.production.board(), staleTime: 0, refetchOnMount: 'always' })
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const move = async (job: BoardJob, status: ProductionStatus) => {
    if (job.status === status) return
    qc.setQueryData<BoardJob[]>(['board'], (old) => old?.map((j) => (key(j) === key(job) ? { ...j, status } : j)))
    try {
      await api.production.setStatus({ kind: job.kind, id: job.id }, status)
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (e) {
      toast.error(e)
      void qc.invalidateQueries({ queryKey: ['board'] })
    }
  }
  const onDragEnd = (e: DragEndEvent) => {
    const job = data?.find((j) => key(j) === e.active.id)
    if (job && e.over) void move(job, e.over.id as ProductionStatus)
  }

  return (
    <>
      <PageHeader
        title="Production"
        subtitle="Approved quotes and their invoices, by stage. Drag a card to move it. Finished jobs stay in the last column for 30 days."
        actions={
          <Button icon={<Package className="size-4" />} onClick={() => navigate('/production/garment-order')}>
            Garment order list
          </Button>
        }
      />
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState icon={<Shirt className="size-8" />} title="No jobs in production">
          Approving a quote puts it on the board at “Awaiting art”.
        </EmptyState>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-4">
            {PRODUCTION_STATUSES.map((s) => (
              <Column key={s} status={s} jobs={data.filter((j) => j.status === s)} onMove={move} />
            ))}
          </div>
        </DndContext>
      )}
    </>
  )
}
