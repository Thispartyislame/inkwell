import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QuoteBreakdown } from '@shared/pricing/types'
import { isEditable, priceQuoteDoc, QuoteEditSchema, type QuoteDetail, type QuoteEdit, type QuoteRecord } from '@shared/quote'
import { fieldErrors } from '@shared/schemas'
import { api, errorMessage } from '../../lib/api'

export type SaveState = { kind: 'saved' } | { kind: 'dirty' } | { kind: 'saving' } | { kind: 'error'; message: string }

export function toEdit(q: QuoteRecord): QuoteEdit {
  const keys = Object.keys(QuoteEditSchema.shape) as (keyof QuoteEdit)[]
  return Object.fromEntries(keys.map((k) => [k, q[k]])) as QuoteEdit
}

/**
 * Holds the quote being edited, prices it live with the shared engine, and autosaves drafts
 * (debounced, one save in flight at a time, the latest edit always wins).
 */
export function useQuoteEditor(initial: QuoteDetail) {
  const [detail, setDetail] = useState(initial)
  const [edit, setEditState] = useState<QuoteEdit>(() => toEdit(initial.quote))
  const [save, setSave] = useState<SaveState>({ kind: 'saved' })
  const latest = useRef(edit)
  const inFlight = useRef<Promise<void> | null>(null)
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editable = isEditable(detail.quote)

  const breakdown: QuoteBreakdown = useMemo(() => {
    try {
      return priceQuoteDoc(edit, detail.pricing.base, detail.pricing.customer as never, detail.pricing.priced_on)
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
    const check = QuoteEditSchema.safeParse(doc)
    if (!check.success) {
      const [field, message] = Object.entries(fieldErrors(check.error))[0] ?? ['', 'Invalid quote']
      setSave({ kind: 'error', message: `${message}${field ? ` (${field.replace(/\./g, ' › ')})` : ''}` })
      return
    }
    setSave({ kind: 'saving' })
    inFlight.current = (async () => {
      try {
        const d = await api.quotes.save(doc)
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
    (fn: (e: QuoteEdit) => QuoteEdit) => {
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
        void api.quotes.save(latest.current).catch(() => {})
      }
    },
    []
  )

  /** Replace everything from the server (after an action like Mark sent). */
  const reset = useCallback((d: QuoteDetail) => {
    setDetail(d)
    const e = toEdit(d.quote)
    latest.current = e
    setEditState(e)
    setSave({ kind: 'saved' })
  }, [])

  return { detail, edit, update, breakdown, save, flush, reset, editable }
}
