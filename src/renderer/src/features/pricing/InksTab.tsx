import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { INK_TYPE_LABELS, INK_TYPES, InkSchema, type Ink, type InkInput } from '@shared/schemas'
import { useAsync } from '../../components/toast'
import { Badge, Button, Checkbox, Dialog, Field, Input, Loading, Select, Table, Td, Textarea, TextField, Th } from '../../components/ui'
import { api } from '../../lib/api'
import { useForm } from '../../lib/form'
import { useInks, useInvalidate } from '../../lib/queries'

function InkDialog({ ink, onClose }: { ink: Ink | 'new'; onClose: () => void }) {
  const f = useForm<InkInput>(ink === 'new' ? { name: '', pms: '', hex: '#000000', type: 'plastisol', notes: '' } : { id: ink.id, name: ink.name, pms: ink.pms, hex: ink.hex, type: ink.type, notes: ink.notes })
  const run = useAsync()
  const invalidate = useInvalidate()
  const save = async () => {
    const data = f.validate(InkSchema)
    if (!data) return
    if (await run(() => api.pricing.saveInk(data), 'Ink saved')) {
      await invalidate('inks')
      onClose()
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={ink === 'new' ? 'New ink' : 'Edit ink'}
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
        <TextField label="Name" value={f.values.name} onChange={(x) => f.set('name', x)} error={f.errors.name} autoFocus />
        <TextField label="Pantone / PMS" value={f.values.pms} onChange={(x) => f.set('pms', x)} placeholder="PMS 186 C" />
        <Field label="Display color" error={f.errors.hex}>
          <div className="flex gap-2">
            <input type="color" value={f.values.hex} onChange={(e) => f.set('hex', e.target.value)} className="h-9 w-12 rounded border border-slate-300" aria-label="Pick color" />
            <Input value={f.values.hex} onChange={(e) => f.set('hex', e.target.value)} invalid={!!f.errors.hex} />
          </div>
        </Field>
        <Field label="Type">
          <Select value={f.values.type} onChange={(e) => f.set('type', e.target.value as InkInput['type'])}>
            {INK_TYPES.map((t) => (
              <option key={t} value={t}>
                {INK_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" className="col-span-2">
          <Textarea rows={2} value={f.values.notes} onChange={(e) => f.set('notes', e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}

export function InksTab() {
  const [archived, setArchived] = useState(false)
  const { data, isLoading } = useInks(archived)
  const [editing, setEditing] = useState<Ink | 'new' | null>(null)
  const run = useAsync()
  const invalidate = useInvalidate()
  if (isLoading) return <Loading />
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-600 dark:text-slate-400">Your inks, used to name separations and label films (Phase 5).</p>
        <div className="flex items-center gap-3">
          <Checkbox checked={archived} onChange={setArchived} label="Show archived" />
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            New ink
          </Button>
        </div>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Ink</Th>
            <Th>Pantone</Th>
            <Th>Type</Th>
            <Th>Notes</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((k) => (
            <tr key={k.id}>
              <Td>
                <span className="flex items-center gap-2 font-medium">
                  <span className="size-4 rounded-full border border-slate-300" style={{ background: k.hex }} />
                  {k.name}
                  {k.archived_at && <Badge>Archived</Badge>}
                </span>
              </Td>
              <Td>{k.pms}</Td>
              <Td>{INK_TYPE_LABELS[k.type]}</Td>
              <Td className="max-w-xs truncate text-slate-500">{k.notes}</Td>
              <Td className="text-right whitespace-nowrap">
                <Button size="sm" variant="ghost" aria-label={`Edit ${k.name}`} onClick={() => setEditing(k)}>
                  <Pencil className="size-3.5" />
                </Button>
                {k.archived_at ? (
                  <Button size="sm" variant="ghost" aria-label={`Restore ${k.name}`} onClick={() => run(async () => (await api.pricing.restoreInk(k.id), invalidate('inks')), 'Ink restored')}>
                    <ArchiveRestore className="size-3.5" />
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" aria-label={`Archive ${k.name}`} onClick={() => run(async () => (await api.pricing.archiveInk(k.id), invalidate('inks')), 'Ink archived')}>
                    <Archive className="size-3.5" />
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && <InkDialog ink={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
