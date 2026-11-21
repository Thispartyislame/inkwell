import * as Menu from '@radix-ui/react-dropdown-menu'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, ArrowLeft, Check, CheckCircle2, Copy, Eye, FileDown, FileText, GitBranch, Loader2, MoreHorizontal, Plus, RefreshCw, Send, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { todayIso } from '@shared/dates'
import { formatMoney } from '@shared/money'
import { effectiveStatus, newLine, type QuoteDetail, type QuoteEdit } from '@shared/quote'
import { useAsync, useToast } from '../../components/toast'
import { Button, Card, ConfirmDialog, cx, Dialog, EmptyState, Field, Input, Loading, Notice, Select, Textarea, TextField } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useInvalidate } from '../../lib/queries'
import { AttachmentsCard } from './Attachments'
import { cloneLine, LineItemCard } from './LineItemCard'
import { CustomerPicker } from './pickers'
import { PreviewDialog } from './PreviewDialog'
import { FeesCard, TotalsCard } from './QuoteSidebar'
import { QuoteStatusBadge } from './status'
import { useQuoteEditor, type SaveState } from './useQuoteEditor'

export function QuoteBuilderPage() {
  const id = Number(useParams().id)
  const qc = useQueryClient()
  const [version, setVersion] = useState(0)
  const { data, error, isLoading } = useQuery({ queryKey: ['quote', id], queryFn: () => api.quotes.get(id), staleTime: Infinity, gcTime: 0, refetchOnMount: 'always' })
  if (isLoading) return <Loading />
  if (error || !data) return <EmptyState title="Quote not found">{error ? errorMessage(error) : ''}</EmptyState>
  return (
    <Builder
      key={`${id}-${version}`}
      initial={data}
      onReload={(d) => {
        qc.setQueryData(['quote', id], d)
        setVersion((v) => v + 1)
      }}
    />
  )
}

function SaveIndicator({ s }: { s: SaveState }) {
  if (s.kind === 'saving' || s.kind === 'dirty')
    return (
      <span className="flex items-center gap-1 text-xs text-slate-500">
        <Loader2 className="size-3 animate-spin" /> Saving…
      </span>
    )
  if (s.kind === 'error') return <span className="max-w-xs truncate text-xs text-red-600" title={s.message}>Not saved: {s.message}</span>
  return (
    <span className="flex items-center gap-1 text-xs text-slate-500">
      <Check className="size-3" /> Saved
    </span>
  )
}

function MenuItem({ icon, children, onSelect, danger }: { icon: React.ReactNode; children: React.ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <Menu.Item onSelect={onSelect} className={cx('flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100 dark:data-[highlighted]:bg-slate-800', danger && 'text-red-600')}>
      {icon}
      {children}
    </Menu.Item>
  )
}

function Builder({ initial, onReload }: { initial: QuoteDetail; onReload: (d: QuoteDetail) => void }) {
  const { detail, edit, update, breakdown, save, flush, editable } = useQuoteEditor(initial)
  const q = detail.quote
  const navigate = useNavigate()
  const run = useAsync()
  const toast = useToast()
  const invalidate = useInvalidate()
  const [preview, setPreview] = useState(false)
  const [approving, setApproving] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [approver, setApprover] = useState('')
  const [reason, setReason] = useState('')
  const [removing, setRemoving] = useState<number | null>(null)
  const [busy, setBusy] = useState('')
  const status = effectiveStatus(q, todayIso())
  const customerName = detail.customer && edit.customer_id === detail.customer.id ? detail.customer.display_name : edit.customer_id ? '…' : ''

  const act = async (name: string, fn: () => Promise<QuoteDetail | void>, success?: string) => {
    setBusy(name)
    try {
      await flush()
      const d = await fn()
      if (success) toast.success(success)
      if (d) onReload(d)
      await invalidate('quotes', 'customers', 'customer')
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy('')
    }
  }
  const goTo = async (name: string, fn: () => Promise<{ id: number; number: string }>, msg: (n: string) => string) => {
    setBusy(name)
    try {
      await flush()
      const n = await fn()
      toast.success(msg(n.number))
      await invalidate('quotes')
      navigate(`/quotes/${n.id}`)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy('')
    }
  }

  const setLines = (fn: (lines: QuoteEdit['lines']) => QuoteEdit['lines']) => update((e) => ({ ...e, lines: fn(e.lines) }))
  const lineWarnings = (uid: string) => breakdown.warnings.filter((w) => w.line_uid === uid && w.code !== 'unit_override' && w.code !== 'no_quantity')
  const quoteWarnings = breakdown.warnings.filter((w) => !w.line_uid && w.code !== 'exempt_cert_expired')

  return (
    <div className="flex flex-col gap-5">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/quotes" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-3" /> Quotes
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            {q.number}
            <QuoteStatusBadge status={status} />
            {q.archived_at && <span className="text-sm font-normal text-slate-500">(archived)</span>}
            {q.is_reorder && <span className="text-sm font-normal text-slate-500">· reorder</span>}
          </h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-slate-500">
            <span className="text-lg font-semibold text-slate-900 tabular dark:text-white">{formatMoney(breakdown.total_cents)}</span>
            {editable && <SaveIndicator s={save} />}
            {q.approved_at && <span>Approved {new Date(q.approved_at).toLocaleDateString()}{q.approved_by_name ? ` by ${q.approved_by_name}` : ''}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={<Eye className="size-4" />} onClick={async () => (await flush(), setPreview(true))}>
            Preview
          </Button>
          <Button icon={<FileText className="size-4" />} busy={busy === 'open'} onClick={() => act('open', async () => void (await api.quotes.openPdf(q.id)))}>
            Open PDF
          </Button>
          <Button
            icon={<FileDown className="size-4" />}
            busy={busy === 'save'}
            onClick={() =>
              act('save', async () => {
                const p = await api.quotes.savePdf(q.id)
                if (p) toast.success(`Saved ${p.split(/[\\/]/).pop()}${q.status === 'draft' ? '. Mark it as sent once you’ve sent it.' : ''}`)
              })
            }
          >
            Save PDF
          </Button>
          {q.status === 'draft' && !q.archived_at && (
            <Button variant="primary" icon={<Send className="size-4" />} busy={busy === 'sent'} onClick={() => act('sent', () => api.quotes.markSent(q.id), `${q.number} marked as sent`)}>
              Mark as sent
            </Button>
          )}
          {['draft', 'sent', 'expired'].includes(q.status) && !q.archived_at && (
            <Button variant={q.status === 'draft' ? 'secondary' : 'primary'} icon={<CheckCircle2 className="size-4" />} onClick={() => setApproving(true)}>
              Approve
            </Button>
          )}
          {!['draft', 'superseded'].includes(q.status) && !q.converted_invoice_id && (
            <Button icon={<GitBranch className="size-4" />} busy={busy === 'revise'} onClick={() => goTo('revise', () => api.quotes.revise(q.id), (n) => `Created revision ${n}`)}>
              Revise
            </Button>
          )}
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button aria-label="More actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <MenuItem icon={<Copy className="size-4" />} onSelect={() => goTo('dup', () => api.quotes.duplicate(q.id), (n) => `Copied to ${n}`)}>
                  Duplicate quote
                </MenuItem>
                <MenuItem icon={<RefreshCw className="size-4" />} onSelect={() => goTo('reorder', () => api.quotes.reorder(q.id), (n) => `Reorder ${n} created; screens marked as on file`)}>
                  Reorder this job
                </MenuItem>
                {['sent', 'expired', 'draft'].includes(q.status) && !q.archived_at && (
                  <MenuItem icon={<XCircle className="size-4" />} onSelect={() => setDeclining(true)}>
                    Mark as declined
                  </MenuItem>
                )}
                <Menu.Separator className="my-1 h-px bg-slate-200 dark:bg-slate-700" />
                {q.archived_at ? (
                  <MenuItem icon={<ArchiveRestore className="size-4" />} onSelect={() => act('arch', () => api.quotes.restore(q.id), 'Quote restored')}>
                    Restore
                  </MenuItem>
                ) : (
                  <MenuItem icon={<Archive className="size-4" />} onSelect={() => act('arch', () => api.quotes.archive(q.id), 'Quote archived (find it with “Show archived”)')}>
                    Archive
                  </MenuItem>
                )}
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>

      {!editable && (
        <Notice tone="blue">
          {q.archived_at
            ? 'This quote is archived. Restore it to make changes.'
            : q.status === 'superseded'
              ? 'This is an older revision, kept for history.'
              : `This quote is ${status}, so its prices are locked. Use Revise to make a new version (${q.root_number}-R${Math.max(...detail.revisions.map((r) => r.revision)) + 1}).`}
        </Notice>
      )}
      {detail.revisions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          Revisions:
          {detail.revisions.map((r) => (
            <Link key={r.id} to={`/quotes/${r.id}`} className={cx('rounded px-1.5 py-0.5', r.id === q.id ? 'bg-accent/10 font-semibold text-accent' : 'hover:underline')}>
              {r.number}
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-5">
        <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
          <Card>
            <div className="grid grid-cols-6 gap-3">
              <Field label="Customer" className="col-span-3">
                <CustomerPicker value={edit.customer_id ? { id: edit.customer_id, name: customerName } : null} onChange={(id) => update((e) => ({ ...e, customer_id: id, contact_id: null }))} />
              </Field>
              <TextField className="col-span-3" label="Job name" value={edit.job_name} onChange={(v) => update((e) => ({ ...e, job_name: v }))} placeholder="Summer staff tees" />
              <Field label="Quote date" className="col-span-2">
                <Input type="date" value={edit.issued_on} onChange={(e) => e.target.value && update((x) => ({ ...x, issued_on: e.target.value }))} />
              </Field>
              <Field label="Valid until" className="col-span-2">
                <Input type="date" value={edit.expires_on ?? ''} onChange={(e) => update((x) => ({ ...x, expires_on: e.target.value || null }))} />
              </Field>
              <Field label="In-hands date" className="col-span-2">
                <Input type="date" value={edit.in_hands_on ?? ''} onChange={(e) => update((x) => ({ ...x, in_hands_on: e.target.value || null }))} />
              </Field>
            </div>
            {detail.customer?.tax_exempt && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">Tax-exempt customer{detail.customer.exempt_cert_number ? ` (certificate ${detail.customer.exempt_cert_number})` : ''}.</p>}
          </Card>

          {edit.lines.map((l, i) => (
            <LineItemCard
              key={l.uid}
              line={l}
              index={i}
              count={edit.lines.length}
              lb={breakdown.lines[i]}
              warnings={lineWarnings(l.uid)}
              base={detail.pricing.base}
              customerMatrixId={detail.pricing.customer?.pricing_matrix_id ?? null}
              onChange={(x) => setLines((ls) => ls.map((y, j) => (j === i ? x : y)))}
              onDuplicate={() => setLines((ls) => [...ls.slice(0, i + 1), cloneLine(l), ...ls.slice(i + 1)])}
              onRemove={() => (l.sizes.some((s) => s.qty > 0) ? setRemoving(i) : setLines((ls) => ls.filter((_, j) => j !== i)))}
              onMove={(dir) =>
                setLines((ls) => {
                  const next = [...ls]
                  ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
                  return next
                })
              }
              onApplyImprintsToAll={() => {
                setLines((ls) => ls.map((y, j) => (j === i ? y : { ...y, imprints: l.imprints.map((imp) => ({ ...cloneLine({ ...l, imprints: [imp] }).imprints[0], underbase: imp.method === 'screen' && imp.underbase_source === 'auto' ? y.is_dark : imp.underbase })) })))
                toast.success(`Imprints copied to ${edit.lines.length - 1} other line${edit.lines.length > 2 ? 's' : ''}`)
              }}
            />
          ))}
          <Button className="self-start" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, newLine()])}>
            Add line item
          </Button>

          <FeesCard edit={edit} breakdown={breakdown} update={update} />

          <div className="grid grid-cols-2 gap-5">
            <Card title="Notes for the customer">
              <Textarea rows={4} value={edit.customer_notes} onChange={(e) => update((x) => ({ ...x, customer_notes: e.target.value }))} placeholder="Shown on the quote PDF" />
            </Card>
            <Card title="Internal notes">
              <Textarea rows={4} value={edit.internal_notes} onChange={(e) => update((x) => ({ ...x, internal_notes: e.target.value }))} placeholder="Never shown to the customer" />
            </Card>
          </div>
        </fieldset>

        <div className="sticky top-0 flex flex-col gap-4">
          <fieldset disabled={!editable}>
            <TotalsCard edit={edit} breakdown={breakdown} defaultTaxBp={detail.pricing.base.default_tax_bp} update={update} />
          </fieldset>
          {quoteWarnings.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-400">
              {quoteWarnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <AttachmentsCard quoteId={q.id} attachments={detail.attachments} editable={editable} onChanged={async () => onReload(await api.quotes.get(q.id))} />

      {detail.activity.length > 0 && (
        <Card title="History">
          <ul className="flex flex-col gap-1 text-sm">
            {detail.activity.map((a) => (
              <li key={a.id} className="flex gap-3">
                <span className="w-40 shrink-0 text-xs text-slate-500 tabular">{new Date(a.created_at).toLocaleString()}</span>
                <span>
                  {a.action[0].toUpperCase() + a.action.slice(1)}
                  {Object.entries(a.details).map(([k, v]) => (
                    <span key={k} className="text-slate-500">
                      {' '}
                      · {k.replace(/_/g, ' ')}: {String(v)}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <PreviewDialog quoteId={q.id} open={preview} onOpenChange={setPreview} version={`${q.updated_at}-${detail.breakdown.total_cents}-${detail.attachments.length}`} />
      <Dialog
        open={approving}
        onOpenChange={setApproving}
        title={`Approve ${q.number}`}
        description={q.status === 'draft' ? 'Approving locks the prices. Convert it to an invoice in Phase 3.' : undefined}
        footer={
          <>
            <Button onClick={() => setApproving(false)}>Cancel</Button>
            <Button variant="primary" busy={busy === 'approve'} onClick={() => act('approve', () => api.quotes.approve(q.id, approver), `${q.number} approved`).then(() => setApproving(false))}>
              Approve
            </Button>
          </>
        }
      >
        <TextField label="Approved by (optional)" value={approver} onChange={setApprover} placeholder={detail.customer ? `${detail.customer.first_name} ${detail.customer.last_name}`.trim() : ''} autoFocus />
      </Dialog>
      <Dialog
        open={declining}
        onOpenChange={setDeclining}
        title={`Mark ${q.number} as declined`}
        footer={
          <>
            <Button onClick={() => setDeclining(false)}>Cancel</Button>
            <Button variant="danger" busy={busy === 'decline'} onClick={() => act('decline', () => api.quotes.decline(q.id, reason), `${q.number} marked as declined`).then(() => setDeclining(false))}>
              Mark declined
            </Button>
          </>
        }
      >
        <Field label="Reason (optional, internal)">
          <Select value={['', 'Price', 'Timing', 'Went with another shop', 'Project cancelled'].includes(reason) ? reason : 'other'} onChange={(e) => setReason(e.target.value === 'other' ? ' ' : e.target.value)}>
            <option value="">No reason given</option>
            <option>Price</option>
            <option>Timing</option>
            <option>Went with another shop</option>
            <option>Project cancelled</option>
            <option value="other">Other…</option>
          </Select>
        </Field>
        {!['', 'Price', 'Timing', 'Went with another shop', 'Project cancelled'].includes(reason) && <Input className="mt-2" value={reason.trimStart()} onChange={(e) => setReason(e.target.value || ' ')} placeholder="Reason" autoFocus />}
      </Dialog>
      <ConfirmDialog open={removing != null} onOpenChange={(o) => !o && setRemoving(null)} title="Remove line item?" danger confirmLabel="Remove" onConfirm={() => setLines((ls) => ls.filter((_, j) => j !== removing))}>
        This line has quantities entered. It will be removed from the quote.
      </ConfirmDialog>
    </div>
  )
}
