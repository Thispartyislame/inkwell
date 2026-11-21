import { Archive, ArchiveRestore, ArrowLeft, FileText, Mail, Paperclip, Pencil, Phone, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { formatMoney } from '@shared/money'
import { ContactSchema, customerDisplayName, type Contact, type ContactInput, type Customer } from '@shared/schemas'
import { useAsync } from '../../components/toast'
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, Loading, Notice, PageHeader, TextField } from '../../components/ui'
import { api } from '../../lib/api'
import { useForm } from '../../lib/form'
import { useCustomer, useInvalidate } from '../../lib/queries'
import { exemptStatus } from './exempt'
import { QuoteStatusBadge } from '../quotes/status'
import { useNewQuote } from '../quotes/QuotesList'
import type { QuoteStatus } from '@shared/quote'
import { formatDate } from '@shared/dates'

function address(c: Customer, kind: 'billing' | 'shipping') {
  const k = (s: string) => c[`${kind}_${s}` as keyof Customer] as string
  const cityLine = [k('city'), [k('state'), k('postal_code')].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [k('line1'), k('line2'), cityLine].filter(Boolean)
}

function ContactDialog({ customerId, contact, onClose }: { customerId: number; contact: Contact | 'new' | null; onClose: () => void }) {
  const invalidate = useInvalidate()
  const run = useAsync()
  const initial: ContactInput = contact && contact !== 'new' ? { ...contact } : { customer_id: customerId, name: '', email: '', phone: '', role: '' }
  const f = useForm<ContactInput>(initial)
  const save = async () => {
    const data = f.validate(ContactSchema)
    if (!data) return
    const ok = await run(() => api.customers.saveContact(data).catch((e) => (f.fail(e), Promise.reject(e))))
    if (ok) {
      await invalidate('customer')
      onClose()
    }
  }
  return (
    <Dialog
      open={!!contact}
      onOpenChange={(o) => !o && onClose()}
      title={contact === 'new' ? 'Add contact' : 'Edit contact'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form noValidate
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <TextField label="Name" value={f.values.name} onChange={(x) => f.set('name', x)} error={f.errors.name} autoFocus />
        <TextField label="Role" value={f.values.role} onChange={(x) => f.set('role', x)} placeholder="Buyer, coach, owner…" />
        <TextField label="Email" type="email" value={f.values.email} onChange={(x) => f.set('email', x)} error={f.errors.email} />
        <TextField label="Phone" value={f.values.phone} onChange={(x) => f.set('phone', x)} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

export function CustomerDetailPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { data, isLoading, error } = useCustomer(id)
  const invalidate = useInvalidate()
  const run = useAsync()
  const [contact, setContact] = useState<Contact | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Contact | null>(null)
  const [archiving, setArchiving] = useState(false)
  const newQuote = useNewQuote()

  if (isLoading) return <Loading />
  if (error || !data) return <EmptyState title="Customer not found" action={<Button onClick={() => navigate('/customers')}>Back to customers</Button>} />

  const c = data.customer
  const ex = exemptStatus(c)
  const refresh = () => invalidate('customer', 'customers')

  return (
    <>
      <PageHeader
        back={
          <Link to="/customers" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-3" /> Customers
          </Link>
        }
        title={
          <span className="flex items-center gap-2">
            {customerDisplayName(c)}
            {c.archived_at && <Badge>Archived</Badge>}
          </span>
        }
        subtitle={c.company_name ? [c.first_name, c.last_name].filter(Boolean).join(' ') : undefined}
        actions={
          <>
            {c.archived_at ? (
              <Button icon={<ArchiveRestore className="size-4" />} onClick={() => run(async () => (await api.customers.restore(id), refresh()), 'Customer restored')}>
                Restore
              </Button>
            ) : (
              <Button icon={<Archive className="size-4" />} onClick={() => setArchiving(true)}>
                Archive
              </Button>
            )}
            <Button variant="primary" icon={<Pencil className="size-4" />} onClick={() => navigate(`/customers/${id}/edit`)}>
              Edit
            </Button>
          </>
        }
      />

      {ex.expired && (
        <Notice tone="red" className="mb-4">
          The tax-exempt certificate expired on {c.exempt_cert_expires_on}. Ask the customer for a current one.
        </Notice>
      )}

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <div className="text-xs font-medium text-slate-500">Balance owed</div>
              <div className="mt-1 text-xl font-semibold tabular">{formatMoney(data.balance_cents)}</div>
            </Card>
            <Card>
              <div className="text-xs font-medium text-slate-500">Quotes</div>
              <div className="mt-1 text-xl font-semibold tabular">{data.quotes.length}</div>
            </Card>
            <Card>
              <div className="text-xs font-medium text-slate-500">Invoices</div>
              <div className="mt-1 text-xl font-semibold tabular">{data.invoices.length}</div>
            </Card>
          </div>

          <Card
            title="Quotes"
            actions={
              <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => newQuote(id)} disabled={!!c.archived_at}>
                New quote
              </Button>
            }
          >
            {data.quotes.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <FileText className="size-4" /> No quotes yet. Invoices arrive in Phase 3.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.quotes.map((q) => (
                  <li key={q.id}>
                    <Link to={`/quotes/${q.id}`} className="flex items-center gap-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <span className="w-28 font-medium">{q.number}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-400">{q.job_name}</span>
                      <QuoteStatusBadge status={q.status as QuoteStatus} />
                      <span className="w-24 text-right tabular">{formatMoney(q.total_cents)}</span>
                      <span className="w-24 text-right text-xs text-slate-500">{formatDate(q.issued_on)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Contacts"
            actions={
              <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setContact('new')}>
                Add contact
              </Button>
            }
          >
            {data.contacts.length === 0 ? (
              <p className="text-sm text-slate-500">No additional contacts.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.contacts.map((k) => (
                  <li key={k.id} className="flex items-center gap-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {k.name} {k.role && <span className="font-normal text-slate-500">· {k.role}</span>}
                      </div>
                      <div className="text-xs text-slate-500">{[k.email, k.phone].filter(Boolean).join(' · ')}</div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setContact(k)} aria-label={`Edit ${k.name}`}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(k)} aria-label={`Remove ${k.name}`}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {c.notes && (
            <Card title="Notes">
              <p className="text-sm whitespace-pre-wrap">{c.notes}</p>
            </Card>
          )}

          <Card title="Activity">
            <ul className="flex flex-col gap-1.5 text-sm">
              {data.activity.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <span className="w-36 shrink-0 text-xs text-slate-500 tabular">{new Date(a.created_at).toLocaleString()}</span>
                  <span>
                    {a.action[0].toUpperCase() + a.action.slice(1)}
                    {Array.isArray(a.details.fields) && <span className="text-slate-500"> ({(a.details.fields as string[]).map((x) => x.replace(/_/g, ' ')).join(', ')})</span>}
                    {typeof a.details.name === 'string' && <span className="text-slate-500"> ({a.details.name})</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card title="Details">
            <dl className="flex flex-col gap-3 text-sm">
              {c.email && (
                <div className="flex items-center gap-2">
                  <Mail className="size-4 text-slate-400" />
                  <a className="hover:underline" href={`mailto:${c.email}`}>
                    {c.email}
                  </a>
                </div>
              )}
              {c.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="size-4 text-slate-400" />
                  {c.phone}
                </div>
              )}
              <div>
                <dt className="text-xs font-medium text-slate-500">Billing address</dt>
                <dd>{address(c, 'billing').length ? address(c, 'billing').map((l) => <div key={l}>{l}</div>) : <span className="text-slate-500">–</span>}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">Shipping address</dt>
                <dd>{c.shipping_same_as_billing ? <span className="text-slate-500">Same as billing</span> : address(c, 'shipping').map((l) => <div key={l}>{l}</div>)}</dd>
              </div>
              {c.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {c.tags.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
              )}
            </dl>
          </Card>

          <Card title="Sales tax">
            {ex.exempt ? (
              <div className="flex flex-col gap-2 text-sm">
                <Badge color={ex.expired ? 'red' : 'green'} className="self-start">
                  <ShieldCheck className="size-3" /> {ex.expired ? 'Exempt, certificate expired' : 'Tax-exempt'}
                </Badge>
                {c.exempt_cert_number && <div>Certificate #{c.exempt_cert_number}</div>}
                {c.exempt_cert_expires_on && <div className="text-slate-500">Expires {c.exempt_cert_expires_on}</div>}
                {data.certAttachment ? (
                  <div className="flex items-center gap-2">
                    <Paperclip className="size-4 text-slate-400" />
                    <button className="truncate text-left hover:underline" onClick={() => run(() => api.app.openAttachment(data.certAttachment!.id))}>
                      {data.certAttachment.original_name}
                    </button>
                    <Button size="sm" variant="ghost" aria-label="Remove certificate file" onClick={() => run(async () => (await api.customers.removeCert(id), refresh()), 'Certificate removed')}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Notice className="text-xs">No certificate file on record.</Notice>
                )}
                <Button size="sm" icon={<Paperclip className="size-3.5" />} onClick={() => run(async () => (await api.customers.attachCert(id)) && refresh())}>
                  {data.certAttachment ? 'Replace certificate file' : 'Attach certificate file'}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Taxable. Edit the customer to mark them tax-exempt.</p>
            )}
          </Card>
        </div>
      </div>

      <ContactDialog key={contact === 'new' ? 'new' : contact?.id ?? 'none'} customerId={id} contact={contact} onClose={() => setContact(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove contact?"
        danger
        confirmLabel="Remove"
        onConfirm={async () => {
          await run(async () => (await api.customers.deleteContact(deleting!.id), refresh()), 'Contact removed')
        }}
      >
        {deleting?.name} will be removed from this customer.
      </ConfirmDialog>
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title="Archive customer?"
        confirmLabel="Archive"
        onConfirm={async () => {
          await run(async () => (await api.customers.archive(id), refresh()), 'Customer archived')
        }}
      >
        Archived customers are hidden from lists and search but keep all their history. You can restore them any time with “Show archived”.
      </ConfirmDialog>
    </>
  )
}
