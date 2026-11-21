import { useCallback, useState } from 'react'
import type { z } from 'zod'
import { fieldErrors } from '@shared/schemas'
import { fieldErrorsOf } from './api'

/** Minimal form state: values, per-field errors, validation with the shared zod schemas. */
export function useForm<T extends object>(initial: T) {
  const [values, setValues] = useState<T>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setDirty(true)
    setErrors((e) => {
      if (!e[key as string]) return e
      const { [key as string]: _drop, ...rest } = e
      return rest
    })
  }, [])

  const patch = useCallback((p: Partial<T>) => {
    setValues((v) => ({ ...v, ...p }))
    setDirty(true)
  }, [])

  /** Validate; returns parsed data or null and fills `errors`. */
  const validate = useCallback(
    <S extends z.ZodType>(schema: S, value: unknown = values): z.infer<S> | null => {
      const r = schema.safeParse(value)
      if (r.success) {
        setErrors({})
        return r.data
      }
      setErrors(fieldErrors(r.error))
      return null
    },
    [values]
  )

  /** Show server-side field errors from a failed save. */
  const fail = useCallback((e: unknown) => setErrors(fieldErrorsOf(e)), [])

  const reset = useCallback((v: T) => {
    setValues(v)
    setErrors({})
    setDirty(false)
  }, [])

  return { values, set, patch, errors, setErrors, validate, fail, dirty, setDirty, reset }
}
