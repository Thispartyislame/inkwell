import { PenLine, Plus, Shirt, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { CustomerSchema, customerDisplayName, SUPPLIER_LABELS, type Garment } from '@shared/schemas'
import { Combobox } from '../../components/combobox'
import { useToast } from '../../components/toast'
import { Button, Dialog, TextField } from '../../components/ui'
import { api } from '../../lib/api'
import { useForm } from '../../lib/form'
import { useCustomers, useGarments, useInvalidate } from '../../lib/queries'
import { EMPTY_CUSTOMER } from '../customers/CustomerEditor'

export function CustomerPicker({ value, onChange, invalid }: { value: { id: number; name: string } | null; onChange: (id: number) => void; invalid?: boolean }) {
  const { data } = useCustomers({})
  const [creating, setCreating] = useState<string | null>(null)
  return (
    <>
      <Combobox
        aria-label="Customer"
        invalid={invalid}
        value={value?.name ?? ''}
        placeholder="Search or add a customer…"
        items={(data ?? []).map((c) => ({ key: String(c.id), value: c.id, label: c.display_name, sublabel: [c.company_name && `${c.first_name} ${c.last_name}`.trim(), c.email].filter(Boolean).join(' · '), icon: <Users className="size-4 shrink-0 text-slate-400" /> }))}
        onSelect={onChange}
        actions={[{ label: 'New customer', icon: <UserPlus className="size-4" />, onSelect: (q) => setCreating(q) }]}
      />
      {creating !== null && (
        <QuickCustomerDialog
          initialName={creating}
          onClose={() => setCreating(null)}
          onCreated={(id) => {
            setCreating(null)
            onChange(id)
          }}
        />
      )}
    </>
  )
}

function QuickCustomerDialog({ initialName, onClose, onCreated }: { initialName: string; onClose: () => void; onCreated: (id: number) => void }) {
  const looksLikePerson = /^\S+\s+\S+$/.test(initialName) && !/\b(inc|llc|co|company|school|club|church|team)\b/i.test(initialName)
  const [first, ...rest] = initialName.split(/\s+/)
  const f = useForm({
    ...EMPTY_CUSTOMER,
    company_name: looksLikePerson ? '' : initialName,
    first_name: looksLikePerson ? first : '',
    last_name: looksLikePerson ? rest.join(' ') : ''
  })
  const toast = useToast()
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const data = f.validate(CustomerSchema)
    if (!data) return
    setBusy(true)
    try {
      const c = await api.customers.save(data)
      await invalidate('customers')
      toast.success(`${customerDisplayName(c)} added`)
      onCreated(c.id)
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
      title="New customer"
      description="Just the basics now; add addresses and tax details on the customer page."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={save}>
            Add customer
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
        <TextField className="col-span-2" label="Company / organization" value={f.values.company_name} onChange={(x) => f.set('company_name', x)} error={f.errors.company_name} autoFocus />
        <TextField label="First name" value={f.values.first_name} onChange={(x) => f.set('first_name', x)} />
        <TextField label="Last name" value={f.values.last_name} onChange={(x) => f.set('last_name', x)} />
        <TextField label="Email" type="email" value={f.values.email} onChange={(x) => f.set('email', x)} error={f.errors.email} />
        <TextField label="Phone" value={f.values.phone} onChange={(x) => f.set('phone', x)} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

export type GarmentChoice = { kind: 'catalog'; garment: Garment } | { kind: 'custom'; description: string; customerSupplied: boolean }

export function GarmentPicker({ label, onPick, autoFocus }: { label: string; onPick: (c: GarmentChoice) => void; autoFocus?: boolean }) {
  const { data } = useGarments({ activeOnly: true })
  return (
    <Combobox
      aria-label="Garment"
      autoFocus={autoFocus}
      value={label}
      placeholder="Search garments: brand, style, name…"
      items={(data ?? []).map((g) => ({
        key: String(g.id),
        value: g,
        label: `${[g.brand, g.style_number].filter(Boolean).join(' ')} – ${g.name}`,
        sublabel: [g.supplier === 'other' ? g.supplier_other : SUPPLIER_LABELS[g.supplier], `${g.colors.length} colors`].filter(Boolean).join(' · '),
        icon: <Shirt className="size-4 shrink-0 text-slate-400" />
      }))}
      onSelect={(g) => onPick({ kind: 'catalog', garment: g })}
      actions={[
        { label: 'Custom item', icon: <PenLine className="size-4" />, onSelect: (q) => onPick({ kind: 'custom', description: q, customerSupplied: false }) },
        { label: 'Customer-supplied garment', icon: <Plus className="size-4" />, onSelect: (q) => onPick({ kind: 'custom', description: q, customerSupplied: true }) }
      ]}
    />
  )
}
