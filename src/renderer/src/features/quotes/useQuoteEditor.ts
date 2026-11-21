import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { z } from 'zod'
import type { QuoteBreakdown } from '@shared/pricing/types'
import { isEditable, priceQuoteDoc, QuoteEditSchema, type FrozenPricing, type PricedDoc, type QuoteDetail, type QuoteEdit, type QuoteRecord } from '@shared/quote'
import { fieldErrors } from '@shared/schemas'
import { api, errorMessage } from '../../lib/api'

export type SaveState = { kind: 'saved' } | { kind: 'dirty' } | { kind: 'saving' } | { kind: 'error'; message: string }

export function toEdit(q: QuoteRecord): QuoteEdit {
  const keys = Object.keys(QuoteEditSchema.shape) as (keyof QuoteEdit)[]
  return Object.fromEntries(keys.map((k) => [k, q[k]])) as QuoteEdit
}

export interface DocEditorConfig<E, D> {
  toEdit: (d: D) => E
  editable: (d: D) => boolean
  schema: z.ZodType
  save: (e: E) => Promise<D>
  /** money already received (deposits / payments), for the balance */
  paid: (d: D) => number
}

/**
 * Holds a quote or invoice being edited, prices it live with the shared engine, and autosaves
 * drafts (debounced, one save in flight at a time, the latest edit always wins).
 */
export function useDocEditor<E extends PricedDoc, D extends { pricing: FrozenPricing; breakdown: QuoteBreakdown }>(initial: D, cfg: DocEditorConfig<E, D>) {
  const [detail, setDetail] = useState(initial)
  const [edit, setEditState] = useState<E>(() => cfg.toEdit(initial))
  const [save, setSave] = useState<SaveState>({ kind: 'saved' })
  const latest = useRef(edit)
  const inFlight = useRef<Promise<void> | null>(null)
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  const editable = cfg.editable(detail)

  const breakdown: QuoteBreakdown = useMemo(() => {
    try {
      return priceQuoteDoc(edit, detail.pricing.base, detail.pricing.customer, detail.pricing.priced_on, cfgRef.current.paid(detail))
    } catch {
      return detail.breakdown
    }
  }, [edit, detail])

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (inFlight.current) {
      pending.current = true
      return inFlight.current
    }
    const doc = latest.current
    const check = cfgRef.current.schema.safeParse(doc)
    if (!check.success) {
      const [field, message] = Object.entries(fieldErrors(check.error))[0] ?? ['', 'Invalid']
      setSave({ kind: 'error', message: `${message}${field ? ` (${field.replace(/\./g, ' › ')})` : ''}` })
      return
    }
    setSave({ kind: 'saving' })
    inFlight.current = (async () => {
      try {
        const d = await cfgRef.current.save(doc)
        setDetail(d)
        setSave(latest.current === doc ? { kind: 'saved' } : { kind: 'dirty' })
      } catch (e) {
        setSave({ kind: 'error', message: errorMessage(e) })
      } finally {
        inFlight.current = null
      }
      if (pending.current || latest.current !== doc) {
        pending.current = false
        if (latest.current !== doc) await flush()
      }
    })()
    return inFlight.current
  }, [])

  const update = useCallback(
    (fn: (e: E) => E) => {
      if (!editable) return
      setEditState((cur) => {
        const next = fn(cur)
        latest.current = next
        return next
      })
      setSave({ kind: 'dirty' })
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), 600)
    },
    [editable, flush]
  )

  // Save anything outstanding when leaving the page.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        void cfgRef.current.save(latest.current).catch(() => {})
      }
    },
    []
  )

  return { detail, setDetail, edit, update, breakdown, save, flush, editable }
}

const QUOTE_CONFIG: DocEditorConfig<QuoteEdit, QuoteDetail> = {
  toEdit: (d) => toEdit(d.quote),
  editable: (d) => isEditable(d.quote),
  schema: QuoteEditSchema,
  save: (e) => api.quotes.save(e),
  paid: (d) => d.payments.filter((p) => !p.voided_at).reduce((t, p) => t + p.amount_cents, 0)
}

export const useQuoteEditor = (initial: QuoteDetail) => useDocEditor(initial, QUOTE_CONFIG)
