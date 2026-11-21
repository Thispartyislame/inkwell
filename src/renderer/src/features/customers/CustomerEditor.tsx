import { ArrowLeft } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { CustomerSchema, METHOD_LABELS, type CustomerInput } from '@shared/schemas'
import { useAsync } from '../../components/toast'
import { Button, Card, Field, Input, Loading, PageHeader, Select, Switch, Textarea, TextField } from '../../components/ui'
import { api } from '../../lib/api'
import { useForm } from '../../lib/form'
import { useCustomer, useInvalidate, useMatrices } from '../../lib/queries'

export const EMPTY_CUSTOMER: CustomerInput = {
  company_name: '',
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  billing_line1: '',
  billing_line2: '',
  billing_city: '',
  billing_state: '',
  billing_postal_code: '',
  shipping_same_as_billing: true,
  shipping_line1: '',
  shipping_line2: '',
  shipping_city: '',
  shipping_state: '',
  shipping_postal_code: '',
  tax_exempt: false,
  exempt_cert_number: '',
  exempt_cert_attachment_id: null,
  exempt_cert_expires_on: null,
  pricing_matrix_id: null,
  notes: '',
  tags: []
}

function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '))
  useEffect(() => setText(value.join(', ')), [value])
  return (
    <Input
      value={text}
      placeholder="school, repeat, wholesale"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange([...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))])}
    />
  )
}

export function CustomerEditor() {
  const { id: idParam } = useParams()
  const id = Number(idParam ?? 0)
  const existing = useCustomer(id)
  if (id && existing.isLoading) return <Loading />
  const initial = existing.data ? existing.data.customer : EMPTY_CUSTOMER
  return <Editor key={id} id={id} initial={initial} />
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <Card title={title}>{children}</Card>
}

function Editor({ id, initial }: { id: number; initial: CustomerInput }) {
  const navigate = useNavigate()
  const run = useAsync()
  const invalidate = useInvalidate()
  const matrices = useMatrices()
  const [busy, setBusy] = useState(false)
  const pick = (c: CustomerInput) => Object.fromEntries(Object.keys(EMPTY_CUSTOMER).map((k) => [k, c[k as keyof CustomerInput]])) as CustomerInput
  const f = useForm<CustomerInput>(pick(initial))
  const v = f.values
  const e = f.errors
  const t = (key: keyof CustomerInput, label: string, extra: Record<string, unknown> = {}) => (
    <TextField label={label} value={String(v[key] ?? '')} onChange={(x) => f.set(key, x as never)} error={e[key]} {...extra} />
  )

  const save = async () => {
    const data = f.validate(CustomerSchema, { ...v, id: id || undefined })
    if (!data) return
    setBusy(true)
    const saved = await run(async () => {
      try {
        return await api.customers.save(data)
      } catch (err) {
        f.fail(err)
        throw err
      }
    }, id ? 'Customer saved' : 'Customer added')
    setBusy(false)
    if (saved) {
      await invalidate('customers', 'customer', 'customer-tags')
      navigate(`/customers/${saved.id}`, { replace: true })
    }
  }

  return (
    <form noValidate
      onSubmit={(ev) => {
        ev.preventDefault()
        void save()
      }}
    >
      <PageHeader
        back={
          <Link to={id ? `/customers/${id}` : '/customers'} className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-3" /> {id ? 'Back to customer' : 'Customers'}
          </Link>
        }
        title={id ? 'Edit customer' : 'New customer'}
        actions={
          <>
            <Button onClick={() => navigate(-1)}>Cancel</Button>
            <Button variant="primary" type="submit" busy={busy}>
              Save
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-5">
        <Section title="Contact">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">{t('company_name', 'Company / organization', { autoFocus: true })}</div>
            {t('first_name', 'First name')}
            {t('last_name', 'Last name')}
            {t('email', 'Email', { type: 'email' })}
            {t('phone', 'Phone')}
            <Field label="Tags" className="col-span-2" hint="Comma-separated">
              <TagInput value={v.tags} onChange={(x) => f.set('tags', x)} />
            </Field>
          </div>
        </Section>

        <Section title="Tax and pricing">
          <div className="flex flex-col gap-3">
            <Switch checked={v.tax_exempt} onChange={(x) => f.set('tax_exempt', x)} label="Tax-exempt" hint="No sales tax on this customer’s quotes and invoices." />
            {v.tax_exempt && (
              <div className="grid grid-cols-2 gap-3">
                {t('exempt_cert_number', 'Resale / exemption certificate #')}
                <Field label="Certificate expires" error={e.exempt_cert_expires_on}>
                  <Input type="date" value={v.exempt_cert_expires_on ?? ''} onChange={(ev) => f.set('exempt_cert_expires_on', ev.target.value || null)} />
                </Field>
                <p className="col-span-2 text-xs text-slate-500">Attach the certificate file from the customer page.</p>
              </div>
            )}
            <Field label="Default pricing matrix" hint="Used for this customer’s quotes instead of the shop default.">
              <Select value={v.pricing_matrix_id ?? ''} onChange={(ev) => f.set('pricing_matrix_id', ev.target.value ? Number(ev.target.value) : null)}>
                <option value="">Shop default</option>
                {(matrices.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({METHOD_LABELS[m.method]})
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>

        <Section title="Billing address">
          <div className="grid grid-cols-6 gap-3">
            <div className="col-span-6">{t('billing_line1', 'Street address')}</div>
            <div className="col-span-6">{t('billing_line2', 'Line 2')}</div>
            <div className="col-span-3">{t('billing_city', 'City')}</div>
            <div className="col-span-1">{t('billing_state', 'State')}</div>
            <div className="col-span-2">{t('billing_postal_code', 'ZIP')}</div>
          </div>
        </Section>

        <Section title="Shipping address">
          <Switch checked={v.shipping_same_as_billing} onChange={(x) => f.set('shipping_same_as_billing', x)} label="Same as billing" />
          {!v.shipping_same_as_billing && (
            <div className="mt-3 grid grid-cols-6 gap-3">
              <div className="col-span-6">{t('shipping_line1', 'Street address')}</div>
              <div className="col-span-6">{t('shipping_line2', 'Line 2')}</div>
              <div className="col-span-3">{t('shipping_city', 'City')}</div>
              <div className="col-span-1">{t('shipping_state', 'State')}</div>
              <div className="col-span-2">{t('shipping_postal_code', 'ZIP')}</div>
            </div>
          )}
        </Section>

        <div className="col-span-2">
          <Section title="Notes (internal)">
            <Textarea rows={4} value={v.notes} onChange={(ev) => f.set('notes', ev.target.value)} placeholder="Preferences, ink colors they like, who approves proofs…" />
          </Section>
        </div>
      </div>
    </form>
  )
}
