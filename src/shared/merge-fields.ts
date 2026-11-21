/** Email template merge fields: "Hi {customer_first_name}" → "Hi Dana". Unknown fields stay as typed. */

export const MERGE_FIELDS = [
  'customer_first_name',
  'customer_name',
  'shop_name',
  'quote_number',
  'invoice_number',
  'receipt_number',
  'job_name',
  'total',
  'balance_due',
  'amount',
  'expiration_date',
  'due_date'
] as const
export type MergeField = (typeof MERGE_FIELDS)[number]

export function mergeTemplate(template: string, values: Partial<Record<MergeField, string>>): string {
  return template.replace(/\{([a-z_]+)\}/g, (m, key: string) => {
    const v = values[key as MergeField]
    return v === undefined ? m : v
  })
}

/** Split "a@x.com, b@y.com; c@z.com" into addresses; returns the invalid ones too. */
export function parseEmailList(raw: string): { valid: string[]; invalid: string[] } {
  const parts = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const ok = (s: string) => /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(s)
  return { valid: [...new Set(parts.filter(ok))], invalid: parts.filter((s) => !ok(s)) }
}
