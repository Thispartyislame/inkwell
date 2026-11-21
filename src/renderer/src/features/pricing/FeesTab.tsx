import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { formatMoney } from '@shared/money'
import { FEE_BASIS_LABELS, FeePresetSchema, type FeePreset, type FeePresetInput } from '@shared/schemas'
import { useAsync } from '../../components/toast'
import { Badge, Button, Checkbox, Dialog, Field, Loading, MoneyField, SampleBadge, Select, Switch, Table, Td, TextField, Th } from '../../components/ui'
import { api } from '../../lib/api'
import { useForm } from '../../lib/form'
import { useFees, useInvalidate } from '../../lib/queries'

const KINDS: Record<FeePresetInput['kind'], string> = {
  screen: 'Screens / setup',
  film: 'Film',
  digitizing: 'Digitizing',
  art: 'Art',
  shipping: 'Shipping',
  rush: 'Rush',
  other: 'Other'
}

function FeeDialog({ fee, nextSort, onClose }: { fee: FeePreset | 'new'; nextSort: number; onClose: () => void }) {
  const initial: FeePresetInput = fee === 'new' ? { name: '', kind: 'other', basis: 'per_job', amount_cents: 0, taxable: true, sort_order: nextSort } : { id: fee.id, name: fee.name, kind: fee.kind, basis: fee.basis, amount_cents: fee.amount_cents, taxable: fee.taxable, sort_order: fee.sort_order }
  const f = useForm<FeePresetInput>(initial)
  const run = useAsync()
  const invalidate = useInvalidate()
  const save = async () => {
    const data = f.validate(FeePresetSchema)
    if (!data) return
    if (await run(() => api.pricing.saveFee(data), 'Fee saved')) {
      await invalidate('fees')
      onClose()
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={fee === 'new' ? 'New fee' : 'Edit fee'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <TextField className="col-span-2" label="Name" value={f.values.name} onChange={(x) => f.set('name', x)} error={f.errors.name} autoFocus />
        <MoneyField label="Default amount" value={f.values.amount_cents} onChange={(x) => f.set('amount_cents', x)} />
        <Field label="Charged">
          <Select value={f.values.basis} onChange={(e) => f.set('basis', e.target.value as FeePresetInput['basis'])}>
            {Object.entries(FEE_BASIS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={f.values.kind} onChange={(e) => f.set('kind', e.target.value as FeePresetInput['kind'])}>
            {Object.entries(KINDS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end pb-1">
          <Switch checked={f.values.taxable} onChange={(x) => f.set('taxable', x)} label="Taxable" />
        </div>
      </div>
    </Dialog>
  )
}

export function FeesTab() {
  const [archived, setArchived] = useState(false)
  const { data, isLoading } = useFees(archived)
  const [editing, setEditing] = useState<FeePreset | 'new' | null>(null)
  const run = useAsync()
  const invalidate = useInvalidate()
  if (isLoading) return <Loading />
  const fees = data ?? []
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-600 dark:text-slate-400">Reusable fees you can add to any quote. The amount is a default you can change per quote.</p>
        <div className="flex items-center gap-3">
          <Checkbox checked={archived} onChange={setArchived} label="Show archived" />
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            New fee
          </Button>
        </div>
      </div>
      {fees.some((x) => x.is_sample) && (
        <div className="mb-3">
          <SampleBadge />
        </div>
      )}
      <Table>
        <thead>
          <tr>
            <Th>Fee</Th>
            <Th>Type</Th>
            <Th>Charged</Th>
            <Th>Tax</Th>
            <Th className="text-right">Amount</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {fees.map((fee) => (
            <tr key={fee.id}>
              <Td className="font-medium">
                {fee.name} {fee.archived_at && <Badge>Archived</Badge>}
              </Td>
              <Td>{KINDS[fee.kind]}</Td>
              <Td>{FEE_BASIS_LABELS[fee.basis]}</Td>
              <Td>{fee.taxable ? 'Taxable' : <span className="text-slate-500">Not taxed</span>}</Td>
              <Td className="text-right tabular">{formatMoney(fee.amount_cents)}</Td>
              <Td className="text-right whitespace-nowrap">
                <Button size="sm" variant="ghost" aria-label={`Edit ${fee.name}`} onClick={() => setEditing(fee)}>
                  <Pencil className="size-3.5" />
                </Button>
                {fee.archived_at ? (
                  <Button size="sm" variant="ghost" aria-label={`Restore ${fee.name}`} onClick={() => run(async () => (await api.pricing.restoreFee(fee.id), invalidate('fees')), 'Fee restored')}>
                    <ArchiveRestore className="size-3.5" />
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" aria-label={`Archive ${fee.name}`} onClick={() => run(async () => (await api.pricing.archiveFee(fee.id), invalidate('fees')), 'Fee archived (restore it with “Show archived”)')}>
                    <Archive className="size-3.5" />
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && <FeeDialog fee={editing} nextSort={fees.length} onClose={() => setEditing(null)} />}
    </>
  )
}
