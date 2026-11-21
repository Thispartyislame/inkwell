import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { QuoteBreakdown } from '@shared/pricing/types'
import { newLine, type FrozenPricing, type PricedDoc } from '@shared/quote'
import { useToast } from '../../components/toast'
import { Button, ConfirmDialog } from '../../components/ui'
import { cloneLine, LineItemCard } from './LineItemCard'

/** The list of line items on a quote or invoice, with add / duplicate / move / remove. */
export function LineItemsEditor<E extends PricedDoc>({ edit, update, breakdown, pricing }: { edit: E; update: (fn: (e: E) => E) => void; breakdown: QuoteBreakdown; pricing: FrozenPricing }) {
  const toast = useToast()
  const [removing, setRemoving] = useState<number | null>(null)
  const setLines = (fn: (lines: E['lines']) => E['lines']) => update((e) => ({ ...e, lines: fn(e.lines) }))
  const lineWarnings = (uid: string) => breakdown.warnings.filter((w) => w.line_uid === uid && w.code !== 'unit_override' && w.code !== 'no_quantity')
  return (
    <>
      {edit.lines.map((l, i) => (
        <LineItemCard
          key={l.uid}
          line={l}
          index={i}
          count={edit.lines.length}
          lb={breakdown.lines[i]}
          warnings={lineWarnings(l.uid)}
          base={pricing.base}
          customerMatrixId={pricing.customer?.pricing_matrix_id ?? null}
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
            setLines((ls) =>
              ls.map((y, j) =>
                j === i
                  ? y
                  : { ...y, imprints: l.imprints.map((imp) => ({ ...cloneLine({ ...l, imprints: [imp] }).imprints[0], underbase: imp.method === 'screen' && imp.underbase_source === 'auto' ? y.is_dark : imp.underbase })) }
              )
            )
            toast.success(`Imprints copied to ${edit.lines.length - 1} other line${edit.lines.length > 2 ? 's' : ''}`)
          }}
        />
      ))}
      <Button className="self-start" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, newLine()])}>
        Add line item
      </Button>
      <ConfirmDialog open={removing != null} onOpenChange={(o) => !o && setRemoving(null)} title="Remove line item?" danger confirmLabel="Remove" onConfirm={() => setLines((ls) => ls.filter((_, j) => j !== removing))}>
        This line has quantities entered. It will be removed.
      </ConfirmDialog>
    </>
  )
}
