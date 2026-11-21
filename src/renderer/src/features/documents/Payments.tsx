import { Ban, FileText, Mail, Plus, Receipt } from 'lucide-react'
import { useState } from 'react'
import { todayIso, formatDate } from '@shared/dates'
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, PaymentSchema, type Payment, type PaymentInput } from '@shared/invoice'
import { formatMoney } from '@shared/money'
import { useAsync, useToast } from '../../components/toast'
import { Button, Card, Checkbox, cx, Dialog, Field, Input, MoneyField, Notice, Select, Textarea, TextField } from '../../components/ui'
import { api } from '../../lib/api'
import { useForm } from '../../lib/form'
import { EmailDialog } from './EmailDialog'

export function PaymentDialog({ target, balance, deposit, onClose, onRecorded }: { target: { invoice_id: number } | { quote_id: number }; balance: number; deposit: boolean; onClose: () => void; onRecorded: (p: Payment) => void }) {
  const f = useForm<PaymentInput>({
    invoice_id: 'invoice_id' in target ? target.invoice_id : null,
    quote_id: 'quote_id' in target ? target.quote_id : null,
    received_on: todayIso(),
    amount_cents: Math.max(0, balance),
    method: 'check',
    check_number: '',
    reference: '',
    note: '',
    is_deposit: deposit
  })
  const v = f.values
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const data = f.validate(PaymentSchema)
    if (!data) return
    setBusy(true)
    try {
      const p = await api.payments.record(data)
      toast.success(`${formatMoney(p.amount_cents)} recorded (receipt ${p.receipt_number})`)
      onRecorded(p)
    } catch (e) {
      f.fail(e)
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={deposit ? 'Record deposit' : 'Record payment'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={save}>
            Record {formatMoney(v.amount_cents || 0)}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <MoneyField label="Amount" value={v.amount_cents} onChange={(x) => f.set('amount_cents', x)} error={f.errors.amount_cents} hint={balance > 0 ? `Balance ${formatMoney(balance)}` : undefined} />
        <Field label="Date received" error={f.errors.received_on}>
          <Input type="date" value={v.received_on} onChange={(e) => f.set('received_on', e.target.value)} />
        </Field>
        <Field label="Method">
          <Select value={v.method} onChange={(e) => f.set('method', e.target.value as PaymentInput['method'])}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        {v.method === 'check' ? <TextField label="Check number" value={v.check_number} onChange={(x) => f.set('check_number', x)} /> : <TextField label="Reference (optional)" value={v.reference} onChange={(x) => f.set('reference', x)} placeholder="Transaction ID, last 4…" />}
        <Field label="Note (optional)" className="col-span-2">
          <Textarea rows={2} value={v.note} onChange={(e) => f.set('note', e.target.value)} />
        </Field>
        {'invoice_id' in target && <Checkbox className="col-span-2" checked={v.is_deposit} onChange={(x) => f.set('is_deposit', x)} label="This is a deposit" />}
        {balance > 0 && v.amount_cents > balance && (
          <Notice className="col-span-2">
            That’s {formatMoney(v.amount_cents - balance)} more than the balance; the extra shows as a credit.
          </Notice>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

export function PaymentsCard({ title, payments, balance, canRecord, recordLabel, onRecord, onChanged }: { title: string; payments: Payment[]; balance: number; canRecord: boolean; recordLabel: string; onRecord: () => void; onChanged: () => void }) {
  const run = useAsync()
  const [voiding, setVoiding] = useState<Payment | null>(null)
  const [reason, setReason] = useState('')
  const [emailing, setEmailing] = useState<Payment | null>(null)
  const live = payments.filter((p) => !p.voided_at)
  return (
    <Card
      title={title}
      actions={
        canRecord && (
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={onRecord}>
            {recordLabel}
          </Button>
        )
      }
      bodyClassName="p-0"
    >
      {payments.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">Nothing received yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {payments.map((p) => (
            <li key={p.id} className={cx('flex items-center gap-2 px-4 py-2', p.voided_at && 'text-slate-400 line-through')}>
              <Receipt className="size-4 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <div className="font-medium tabular">
                  {formatMoney(p.amount_cents)} <span className="font-normal text-slate-500">· {PAYMENT_METHOD_LABELS[p.method]}{p.check_number ? ` #${p.check_number}` : ''}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {formatDate(p.received_on)} · {p.receipt_number}
                  {p.is_deposit ? ' · deposit' : ''}
                  {p.voided_at ? ` · voided${p.void_reason ? `: ${p.void_reason}` : ''}` : ''}
                </div>
              </div>
              {!p.voided_at && (
                <span className="flex">
                  <Button size="sm" variant="ghost" title="Open receipt PDF" aria-label={`Open receipt ${p.receipt_number}`} onClick={() => run(() => api.documents.openPdf('receipt', p.id))}>
                    <FileText className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" title="Email receipt" aria-label={`Email receipt ${p.receipt_number}`} onClick={() => setEmailing(p)}>
                    <Mail className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" title="Void payment" aria-label={`Void payment ${p.receipt_number}`} onClick={() => (setReason(''), setVoiding(p))}>
                    <Ban className="size-3.5" />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {live.length > 0 && (
        <div className="flex justify-between border-t border-slate-200 px-4 py-2 text-sm font-semibold dark:border-slate-800">
          <span>{balance < 0 ? 'Credit' : 'Balance'}</span>
          <span className="tabular">{formatMoney(Math.abs(balance))}</span>
        </div>
      )}
      <Dialog
        open={!!voiding}
        onOpenChange={(o) => !o && setVoiding(null)}
        title={`Void ${voiding?.receipt_number}?`}
        description="Use this for a bounced check or a payment entered by mistake. It stays in the history, crossed out."
        footer={
          <>
            <Button onClick={() => setVoiding(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                const ok = await run(() => api.payments.void(voiding!.id, reason), 'Payment voided')
                if (ok) {
                  setVoiding(null)
                  onChanged()
                }
              }}
            >
              Void payment
            </Button>
          </>
        }
      >
        <TextField label="Reason (optional)" value={reason} onChange={setReason} placeholder="Bounced check" autoFocus />
      </Dialog>
      {emailing && <EmailDialog kind="receipt" id={emailing.id} open onOpenChange={(o) => !o && setEmailing(null)} onDone={onChanged} canMarkSent={false} />}
    </Card>
  )
}
