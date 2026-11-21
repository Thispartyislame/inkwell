/** CSV export (RFC 4180): quote fields containing commas, quotes or line breaks. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** Cents as a plain number for spreadsheets: 123456 → "1234.56" */
export function csvMoney(cents: number): string {
  const neg = cents < 0
  const a = Math.abs(cents)
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`
}
