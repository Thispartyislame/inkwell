import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { imprintSummary } from '@shared/pricing/engine'
import { garmentTitle, toImprintInput, type QuoteLine } from '@shared/quote'
import type { SeparationJob } from '@shared/separations/job'
import { useToast } from '../../components/toast'
import { Button, Dialog, Field, Loading, Notice, Select } from '../../components/ui'
import { api } from '../../lib/api'

/** Pick an editable quote or invoice and one of its imprints to take this separation's colors. */
export function LinkDialog({ job, onClose, onLinked }: { job: SeparationJob; onClose: () => void; onLinked: (j: SeparationJob) => void }) {
  const toast = useToast()
  const docs = useQuery({
    queryKey: ['link-targets'],
    queryFn: async () => {
      const [quotes, invoices] = await Promise.all([api.quotes.list({ status: 'draft' }), api.invoices.list({})])
      return [
        ...quotes.map((q) => ({ value: `quote:${q.id}`, label: `${q.number} · ${q.customer_name || 'No customer'}${q.job_name ? ` · ${q.job_name}` : ''}` })),
        ...invoices.filter((i) => i.status !== 'void').map((i) => ({ value: `invoice:${i.id}`, label: `${i.number} · ${i.customer_name || 'No customer'}${i.job_name ? ` · ${i.job_name}` : ''}` }))
      ]
    },
    gcTime: 0
  })
  const [doc, setDoc] = useState(job.owner_type && job.owner_id ? `${job.owner_type}:${job.owner_id}` : '')
  const [kind, idStr] = doc.split(':')
  const lines = useQuery({
    queryKey: ['link-lines', doc],
    queryFn: async () => (kind === 'quote' ? (await api.quotes.get(Number(idStr))).quote.lines : (await api.invoices.get(Number(idStr))).invoice.lines) as QuoteLine[],
    enabled: !!doc,
    gcTime: 0
  })
  const [imprint, setImprint] = useState(job.imprint_uid ?? '')
  const [busy, setBusy] = useState(false)
  const options = (lines.data ?? []).flatMap((l) => l.imprints.map((i) => ({ value: i.uid, label: `${garmentTitle(l)}${l.color_name ? ` (${l.color_name})` : ''}: ${imprintSummary(toImprintInput(i))}` })))

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Link separations to an imprint"
      description={`The imprint becomes a ${job.ink_count}-color screen print${job.has_underbase ? ' with underbase' : ''}, and the screen fee follows. Only draft quotes and unsent invoices can change.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!doc || !imprint}
            onClick={async () => {
              setBusy(true)
              try {
                onLinked(await api.separations.link(job.id, { kind: kind as 'quote' | 'invoice', id: Number(idStr), imprint_uid: imprint }))
              } catch (e) {
                toast.error(e)
              } finally {
                setBusy(false)
              }
            }}
          >
            Link
          </Button>
        </>
      }
    >
      {docs.isLoading ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Quote or invoice">
            <Select
              value={doc}
              onChange={(e) => {
                setDoc(e.target.value)
                setImprint('')
              }}
            >
              <option value="">Choose…</option>
              {(docs.data ?? []).map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          {doc && (lines.isLoading ? <Loading /> : options.length ? (
            <Field label="Imprint">
              <Select value={imprint} onChange={(e) => setImprint(e.target.value)}>
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Notice>That document has no imprints yet. Add one to a line item first.</Notice>
          ))}
        </div>
      )}
    </Dialog>
  )
}
