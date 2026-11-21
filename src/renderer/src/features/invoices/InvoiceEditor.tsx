import * as Menu from '@radix-ui/react-dropdown-menu'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, ArrowLeft, Ban, Check, DollarSign, Eye, FileDown, FileText, Loader2, Mail, MoreHorizontal, RefreshCw, Send } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { todayIso } from '@shared/dates'
import { InvoiceEditSchema, invoiceDisplayStatus, isInvoiceEditable, type InvoiceDetail, type InvoiceEdit } from '@shared/invoice'
import { formatMoney } from '@shared/money'
import { useToast } from '../../components/toast'
import { Button, Card, cx, Dialog, EmptyState, Field, Input, Loading, Notice, Textarea, TextField } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useInvalidate } from '../../lib/queries'
import { EmailDialog } from '../documents/EmailDialog'
import { PaymentDialog, PaymentsCard } from '../documents/Payments'
import { AttachmentsCard } from '../quotes/Attachments'
import { LineItemsEditor } from '../quotes/LineItemsEditor'
import { CustomerPicker } from '../quotes/pickers'
import { PreviewDialog } from '../quotes/PreviewDialog'
import { FeesCard, TotalsCard } from '../quotes/QuoteSidebar'
import { useDocEditor, type DocEditorConfig, type SaveState } from '../quotes/useQuoteEditor'
import { InvoiceStatusBadge } from './status'

const CONFIG: DocEditorConfig<InvoiceEdit, InvoiceDetail> = {
  toEdit: (d) => Object.fromEntries(Object.keys(InvoiceEditSchema.shape).map((k) => [k, d.invoice[k as keyof InvoiceEdit]])) as InvoiceEdit,
  editable: (d) => isInvoiceEditable(d.invoice),
  schema: InvoiceEditSchema,
  save: (e) => api.invoices.save(e),
  paid: (d) => d.invoice.paid_cents
}

const TERMS_SUGGESTIONS = ['Due on receipt', 'Net 7', 'Net 15', 'Net 30', 'Net 45', 'Net 60', '50% deposit, balance at pickup']

export function InvoicePage() {
  const id = Number(useParams().id)
  const qc = useQueryClient()
  const [version, setVersion] = useState(0)
  const { data, error, isLoading } = useQuery({ queryKey: ['invoice', id], queryFn: () => api.invoices.get(id), staleTime: Infinity, gcTime: 0, refetchOnMount: 'always' })
  if (isLoading) return <Loading />
  if (error || !data) return <EmptyState title="Invoice not found">{error ? errorMessage(error) : ''}</EmptyState>
  return (
    <InvoiceEditor
      key={`${id}-${version}`}
      initial={data}
      onReload={(d) => {
        qc.setQueryData(['invoice', id], d)
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

function InvoiceEditor({ initial, onReload }: { initial: InvoiceDetail; onReload: (d: InvoiceDetail) => void }) {
  const { detail, edit, update, breakdown, save, flush, editable } = useDocEditor(initial, CONFIG)
  const inv = detail.invoice
  const toast = useToast()
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(false)
  const [emailing, setEmailing] = useState(false)
  const [paying, setPaying] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const status = invoiceDisplayStatus(inv, todayIso())
  const customerName = detail.customer && edit.customer_id === detail.customer.id ? detail.customer.display_name : edit.customer_id ? '…' : ''
  const balance = inv.status === 'draft' ? breakdown.balance_cents : inv.balance_cents
  const canPay = inv.status !== 'void' && !inv.archived_at && !!inv.customer_id

  const reload = async () => onReload(await api.invoices.get(inv.id))
  const act = async (name: string, fn: () => Promise<InvoiceDetail | void>, success?: string) => {
    setBusy(name)
    try {
      await flush()
      const d = await fn()
      if (success) toast.success(success)
      if (d) onReload(d)
      await invalidate('invoices', 'customers', 'customer', 'quotes')
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/invoices" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-3" /> Invoices
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            {inv.number}
            <InvoiceStatusBadge status={status} />
            {inv.archived_at && <span className="text-sm font-normal text-slate-500">(archived)</span>}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <span>
              Total <span className="font-semibold text-slate-900 tabular dark:text-white">{formatMoney(breakdown.total_cents)}</span>
            </span>
            {inv.status !== 'void' && (
              <span>
                {balance < 0 ? 'Credit' : 'Balance due'} <span className={cx('text-lg font-semibold tabular', balance > 0 ? 'text-slate-900 dark:text-white' : 'text-emerald-600')}>{formatMoney(Math.abs(balance))}</span>
              </span>
            )}
            {editable && <SaveIndicator s={save} />}
            {detail.source_quote && (
              <Link to={`/quotes/${detail.source_quote.id}`} className="hover:underline">
                From quote {detail.source_quote.number}
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={<Eye className="size-4" />} onClick={async () => (await flush(), setPreview(true))}>
            Preview
          </Button>
          <Button icon={<FileText className="size-4" />} busy={busy === 'open'} onClick={() => act('open', async () => void (await api.documents.openPdf('invoice', inv.id)))}>
            Open PDF
          </Button>
          <Button icon={<Mail className="size-4" />} disabled={inv.status === 'void'} onClick={async () => (await flush(), setEmailing(true))}>
            Email
          </Button>
          {!inv.sent_at && inv.status !== 'void' && !inv.archived_at && (
            <Button icon={<Send className="size-4" />} busy={busy === 'sent'} onClick={() => act('sent', () => api.invoices.markSent(inv.id), `${inv.number} marked as sent`)}>
              Mark as sent
            </Button>
          )}
          {canPay && balance > 0 && (
            <Button variant="primary" icon={<DollarSign className="size-4" />} onClick={async () => (await flush(), setPaying(true))}>
              Record payment
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
                <MenuItem
                  icon={<FileDown className="size-4" />}
                  onSelect={() =>
                    act('save', async () => {
                      const p = await api.documents.savePdf('invoice', inv.id)
                      if (p) toast.success(`Saved ${p.split(/[\\/]/).pop()}`)
                    })
                  }
                >
                  Save PDF…
                </MenuItem>
                {editable && inv.pricing_locked && (
                  <MenuItem icon={<RefreshCw className="size-4" />} onSelect={() => act('reprice', () => api.invoices.reprice(inv.id), 'Repriced with your current pricing')}>
                    Reprice with current pricing
                  </MenuItem>
                )}
                {inv.status !== 'void' && (
                  <MenuItem icon={<Ban className="size-4" />} danger onSelect={() => (setReason(''), setVoiding(true))}>
                    Void invoice
                  </MenuItem>
                )}
                <Menu.Separator className="my-1 h-px bg-slate-200 dark:bg-slate-700" />
                {inv.archived_at ? (
                  <MenuItem icon={<ArchiveRestore className="size-4" />} onSelect={() => act('arch', () => api.invoices.restore(inv.id), 'Invoice restored')}>
                    Restore
                  </MenuItem>
                ) : (
                  <MenuItem icon={<Archive className="size-4" />} onSelect={() => act('arch', () => api.invoices.archive(inv.id), 'Invoice archived (find it with “Show archived”)')}>
                    Archive
                  </MenuItem>
                )}
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>

      {inv.status === 'void' ? (
        <Notice tone="red">This invoice is void{inv.void_reason ? `: ${inv.void_reason}` : ''}. It stays for your records and isn’t counted in balances.</Notice>
      ) : !editable ? (
        <Notice tone="blue">
          {inv.archived_at
            ? 'This invoice is archived. Restore it to make changes.'
            : 'This invoice has been sent, so its contents are locked. To change it, void it and create a new one.'}
        </Notice>
      ) : inv.pricing_locked && detail.source_quote ? (
        <Notice tone="blue">Priced exactly as approved on quote {detail.source_quote.number}. Changes you make here use those same prices. Use “Reprice with current pricing” in the menu to switch to today’s pricing.</Notice>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-5">
        <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
          <Card>
            <div className="grid grid-cols-6 gap-3">
              <Field label="Customer" className="col-span-3">
                <CustomerPicker value={edit.customer_id ? { id: edit.customer_id, name: customerName } : null} onChange={(id) => update((e) => ({ ...e, customer_id: id, contact_id: null }))} />
              </Field>
              <TextField className="col-span-2" label="Job name" value={edit.job_name} onChange={(v) => update((e) => ({ ...e, job_name: v }))} />
              <TextField label="PO number" value={edit.po_number} onChange={(v) => update((e) => ({ ...e, po_number: v }))} />
              <Field label="Invoice date" className="col-span-2">
                <Input type="date" value={edit.issued_on} onChange={(e) => e.target.value && update((x) => ({ ...x, issued_on: e.target.value }))} />
              </Field>
              <Field label="Due date" className="col-span-2">
                <Input type="date" value={edit.due_on ?? ''} onChange={(e) => update((x) => ({ ...x, due_on: e.target.value || null }))} />
              </Field>
              <Field label="Payment terms" className="col-span-2">
                <Input list="terms-suggestions" value={edit.payment_terms} onChange={(e) => update((x) => ({ ...x, payment_terms: e.target.value }))} />
              </Field>
              <datalist id="terms-suggestions">
                {TERMS_SUGGESTIONS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
          </Card>

          <LineItemsEditor edit={edit} update={update} breakdown={breakdown} pricing={detail.pricing} />
          <FeesCard edit={edit} breakdown={breakdown} update={update} />

          <div className="grid grid-cols-2 gap-5">
            <Card title="Notes for the customer">
              <Textarea rows={4} value={edit.customer_notes} onChange={(e) => update((x) => ({ ...x, customer_notes: e.target.value }))} placeholder="Shown on the invoice PDF" />
            </Card>
            <Card title="Internal notes">
              <Textarea rows={4} value={edit.internal_notes} onChange={(e) => update((x) => ({ ...x, internal_notes: e.target.value }))} placeholder="Never shown to the customer" />
            </Card>
          </div>
        </fieldset>

        <div className="sticky top-0 flex flex-col gap-4">
          <fieldset disabled={!editable}>
            <TotalsCard edit={edit} breakdown={breakdown} defaultTaxBp={detail.pricing.base.default_tax_bp} update={update} showDeposit={false} />
          </fieldset>
          <PaymentsCard title="Payments" payments={detail.payments} balance={balance} canRecord={canPay} recordLabel="Record payment" onRecord={async () => (await flush(), setPaying(true))} onChanged={reload} />
        </div>
      </div>

      <AttachmentsCard ownerType="invoice" ownerId={inv.id} attachments={detail.attachments} editable={editable} onChanged={reload} />

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
                      · {k.replace(/_/g, ' ')}: {String(v).replace(/_/g, ' ')}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <PreviewDialog kind="invoice" id={inv.id} open={preview} onOpenChange={setPreview} version={`${inv.updated_at}-${inv.paid_cents}-${detail.attachments.length}`} />
      <EmailDialog kind="invoice" id={inv.id} open={emailing} onOpenChange={setEmailing} onDone={reload} canMarkSent={!inv.sent_at} />
      {paying && (
        <PaymentDialog
          target={{ invoice_id: inv.id }}
          balance={balance}
          deposit={false}
          onClose={() => setPaying(false)}
          onRecorded={() => {
            setPaying(false)
            void reload()
            void invalidate('invoices', 'customers', 'customer')
          }}
        />
      )}
      <Dialog
        open={voiding}
        onOpenChange={setVoiding}
        title={`Void ${inv.number}?`}
        description="The invoice stays in your records marked VOID and stops counting toward balances. If it came from a quote, the quote can be invoiced again."
        footer={
          <>
            <Button onClick={() => setVoiding(false)}>Cancel</Button>
            <Button variant="danger" busy={busy === 'void'} onClick={() => act('void', () => api.invoices.void(inv.id, reason), `${inv.number} voided`).then(() => setVoiding(false))}>
              Void invoice
            </Button>
          </>
        }
      >
        <TextField label="Reason (optional)" value={reason} onChange={setReason} autoFocus />
      </Dialog>
    </div>
  )
}
