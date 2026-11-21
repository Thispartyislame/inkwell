import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { SetupInput } from '@shared/ipc'
import { formatDocNumber } from '@shared/numbering'
import { PAYMENT_TERMS, PAYMENT_TERMS_LABELS } from '@shared/schemas'
import { useToast } from '../../components/toast'
import { Button, Field, IntField, PercentField, Select, Textarea, TextField, cx } from '../../components/ui'
import { api, fileUrl } from '../../lib/api'
import { useForm } from '../../lib/form'
import { useSettings } from '../../lib/queries'

const STEPS = ['Your shop', 'Tax & terms', 'Numbering'] as const
const DEFAULT_TERMS = `Quotes are valid until the expiration date shown.
A deposit is required to start production; the balance is due at pickup or delivery.
Colors on screen and printed proofs are approximate. Ink colors may vary slightly by garment.
Customer is responsible for approving spelling, layout and sizes on the proof.
Garment counts may vary by up to 2% due to misprints; any shortages are credited.`

const termsDays: Record<string, number> = { due_on_receipt: 0, net_7: 7, net_15: 15, net_30: 30, net_45: 45, net_60: 60 }

export function SetupWizard() {
  const { data: s } = useSettings()
  const qc = useQueryClient()
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const f = useForm<SetupInput>({
    shop_name: s?.shop_name ?? '',
    address_line1: s?.address_line1 ?? '',
    address_line2: s?.address_line2 ?? '',
    city: s?.city ?? '',
    state: s?.state ?? '',
    postal_code: s?.postal_code ?? '',
    phone: s?.phone ?? '',
    email: s?.email ?? '',
    website: s?.website ?? '',
    default_tax_bp: s?.default_tax_bp ?? 0,
    quote_prefix: s?.quote_prefix ?? 'Q-',
    quote_next_number: s?.quote_next_number ?? 1001,
    invoice_prefix: s?.invoice_prefix ?? 'INV-',
    invoice_next_number: s?.invoice_next_number ?? 1001,
    payment_terms: s?.payment_terms ?? 'due_on_receipt',
    payment_terms_days: s?.payment_terms_days ?? 0,
    default_deposit_bp: s?.default_deposit_bp ?? 5000,
    quote_expiration_days: s?.quote_expiration_days ?? 30,
    terms_text: s?.terms_text || DEFAULT_TERMS
  })
  const v = f.values
  const e = f.errors

  const next = () => {
    if (step === 0) {
      const errs: Record<string, string> = {}
      if (!v.shop_name.trim()) errs.shop_name = 'Enter your shop name'
      if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errs.email = 'Enter a valid email address'
      if (Object.keys(errs).length) return f.setErrors(errs)
    }
    if (step === 2) {
      const errs: Record<string, string> = {}
      if (v.quote_next_number < 1) errs.quote_next_number = 'Must be 1 or more'
      if (v.invoice_next_number < 1) errs.invoice_next_number = 'Must be 1 or more'
      if (v.quote_prefix === v.invoice_prefix) errs.invoice_prefix = 'Use a different prefix than quotes'
      if (Object.keys(errs).length) return f.setErrors(errs)
      return finish()
    }
    setStep(step + 1)
  }

  const finish = async () => {
    setBusy(true)
    try {
      const saved = await api.settings.completeSetup(v)
      qc.setQueryData(['settings'], saved)
      toast.success('You’re all set. Sample pricing is loaded; edit it under Pricing.')
    } catch (err) {
      f.fail(err)
      toast.error(err)
      if (Object.keys(f.errors).some((k) => ['shop_name', 'email'].includes(k))) setStep(0)
    } finally {
      setBusy(false)
    }
  }

  const pickLogo = async () => {
    try {
      const r = await api.settings.pickLogo()
      if (r) qc.setQueryData(['settings'], r)
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-6 dark:from-slate-950 dark:to-slate-900">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-8 pt-7 pb-5 dark:border-slate-800">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Inkwell</h1>
          <p className="mt-1 text-sm text-slate-500">A few details for your quotes and invoices. You can change all of this later in Settings.</p>
          <ol className="mt-5 flex gap-2">
            {STEPS.map((label, i) => (
              <li key={label} className="flex flex-1 flex-col gap-1.5">
                <span className={cx('h-1 rounded-full', i <= step ? 'bg-accent' : 'bg-slate-200 dark:bg-slate-700')} />
                <span className={cx('text-xs font-medium', i === step ? 'text-slate-900 dark:text-white' : 'text-slate-400')}>
                  {i + 1}. {label}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <form noValidate
          className="px-8 py-6"
          onSubmit={(ev) => {
            ev.preventDefault()
            next()
          }}
        >
          {step === 0 && (
            <div className="grid grid-cols-2 gap-4">
              <TextField className="col-span-2" label="Shop name" value={v.shop_name} onChange={(x) => f.set('shop_name', x)} error={e.shop_name} autoFocus />
              <div className="col-span-2 flex items-center gap-4">
                <div className="flex size-16 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800">
                  {s?.logo_path ? <img src={fileUrl(s.logo_path)} alt="Logo" className="size-full object-contain" /> : <ImagePlus className="size-6 text-slate-400" />}
                </div>
                <div className="flex gap-2">
                  <Button onClick={pickLogo}>{s?.logo_path ? 'Change logo' : 'Upload logo'}</Button>
                  {s?.logo_path && (
                    <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={async () => qc.setQueryData(['settings'], await api.settings.clearLogo())}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
              <TextField className="col-span-2" label="Street address" value={v.address_line1} onChange={(x) => f.set('address_line1', x)} />
              <TextField className="col-span-2" label="Address line 2" value={v.address_line2} onChange={(x) => f.set('address_line2', x)} />
              <TextField label="City" value={v.city} onChange={(x) => f.set('city', x)} />
              <div className="grid grid-cols-2 gap-4">
                <TextField label="State" value={v.state} onChange={(x) => f.set('state', x)} />
                <TextField label="ZIP" value={v.postal_code} onChange={(x) => f.set('postal_code', x)} />
              </div>
              <TextField label="Phone" value={v.phone} onChange={(x) => f.set('phone', x)} />
              <TextField label="Email" type="email" value={v.email} onChange={(x) => f.set('email', x)} error={e.email} />
              <TextField className="col-span-2" label="Website" value={v.website} onChange={(x) => f.set('website', x)} />
            </div>
          )}

          {step === 1 && (
            <div className="grid grid-cols-2 gap-4">
              <PercentField label="Sales tax rate" value={v.default_tax_bp} onChange={(x) => f.set('default_tax_bp', x)} hint="Applied to taxable items. Customers can be marked tax-exempt." />
              <PercentField label="Deposit required" value={v.default_deposit_bp} onChange={(x) => f.set('default_deposit_bp', x)} hint="Percent of the total, asked for on quotes." />
              <IntField label="Quotes expire after (days)" value={v.quote_expiration_days} onChange={(x) => f.set('quote_expiration_days', x)} />
              <Field label="Payment terms">
                <Select
                  value={v.payment_terms}
                  onChange={(ev) => {
                    const t = ev.target.value as SetupInput['payment_terms']
                    f.patch({ payment_terms: t, payment_terms_days: termsDays[t] ?? v.payment_terms_days })
                  }}
                >
                  {PAYMENT_TERMS.map((t) => (
                    <option key={t} value={t}>
                      {PAYMENT_TERMS_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              {v.payment_terms === 'custom' && <IntField label="Payment due after (days)" value={v.payment_terms_days} onChange={(x) => f.set('payment_terms_days', x)} />}
              <Field label="Terms & conditions (printed on quotes)" className="col-span-2">
                <Textarea rows={6} value={v.terms_text} onChange={(ev) => f.set('terms_text', ev.target.value)} />
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-2 gap-4">
              <TextField label="Quote prefix" value={v.quote_prefix} onChange={(x) => f.set('quote_prefix', x)} />
              <IntField label="First quote number" value={v.quote_next_number} onChange={(x) => f.set('quote_next_number', x)} error={e.quote_next_number} />
              <TextField label="Invoice prefix" value={v.invoice_prefix} onChange={(x) => f.set('invoice_prefix', x)} error={e.invoice_prefix} />
              <IntField label="First invoice number" value={v.invoice_next_number} onChange={(x) => f.set('invoice_next_number', x)} error={e.invoice_next_number} />
              <div className="col-span-2 rounded-lg bg-slate-50 px-4 py-3 text-sm dark:bg-slate-800">
                Your first quote will be <strong className="tabular">{formatDocNumber(v.quote_prefix, v.quote_next_number || 1)}</strong> and your first invoice{' '}
                <strong className="tabular">{formatDocNumber(v.invoice_prefix, v.invoice_next_number || 1)}</strong>. Numbers are never reused, even if a quote is archived.
              </div>
            </div>
          )}

          <div className="mt-8 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={step === 0}>
              Back
            </Button>
            <Button variant="primary" type="submit" busy={busy}>
              {step === STEPS.length - 1 ? 'Finish setup' : 'Next'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
