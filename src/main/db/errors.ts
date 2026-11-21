import type { z } from 'zod'
import { fieldErrors } from '@shared/schemas'

/** An error whose message is safe and useful to show the user. */
export class UserError extends Error {
  constructor(
    message: string,
    public fields?: Record<string, string>
  ) {
    super(message)
    this.name = 'UserError'
  }
}

export class NotFoundError extends UserError {
  constructor(what: string, id: number | string) {
    super(`${what} ${id} was not found`)
    this.name = 'NotFoundError'
  }
}

/** Validate with a zod schema; on failure throw a UserError carrying per-field messages. */
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value)
  if (!r.success) {
    const fields = fieldErrors(r.error)
    const first = Object.entries(fields)[0]
    throw new UserError(first ? `${first[1]}${first[0] !== '_' ? ` (${first[0]})` : ''}` : 'Invalid input', fields)
  }
  return r.data
}
