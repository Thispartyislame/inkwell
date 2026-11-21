/**
 * Money helpers. All currency is integer cents; all rates are integer basis points
 * (1 bp = 0.01%, so 825 bp = 8.25%). Nothing in here ever produces a fractional cent.
 */

export type Cents = number
export type BasisPoints = number

export const BP_PER_UNIT = 10_000

function assertInt(n: number, what: string): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} must be a safe integer, got ${n}`)
}

/**
 * Integer division rounded half away from zero ("round half up" for positive amounts,
 * which is what customers expect on invoices). Both arguments must be integers.
 */
export function divRound(numerator: number, denominator: number): number {
  assertInt(numerator, 'numerator')
  assertInt(denominator, 'denominator')
  if (denominator === 0) throw new RangeError('division by zero')
  const sign = Math.sign(numerator) * Math.sign(denominator)
  const n = Math.abs(numerator)
  const d = Math.abs(denominator)
  const q = Math.floor(n / d)
  const r = n - q * d
  const rounded = r * 2 >= d ? q + 1 : q
  return sign * rounded || 0
}

/** cents × rate, rounded half up to the cent. */
export function applyBp(cents: Cents, bp: BasisPoints): Cents {
  return divRound(cents * bp, BP_PER_UNIT)
}

/** Round cents to the nearest multiple of `step` cents (half up). step = 1 is a no-op. */
export function roundToStep(cents: Cents, step: number): Cents {
  assertInt(cents, 'cents')
  if (step <= 1) return cents
  return divRound(cents, step) * step
}

/**
 * Parse user input like "12", "12.5", "$1,234.56", "-3.10" into cents without ever
 * going through floating point. Returns null for anything that isn't a money amount
 * or has more than two decimal places.
 */
export function parseMoney(input: string | number | null | undefined): Cents | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null
    input = input.toFixed(2)
  }
  const s = input.trim().replace(/[$,\s]/g, '')
  const m = /^(-)?(\d*)(?:\.(\d{0,2}))?$/.exec(s)
  if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) return null
  const whole = m[2] === '' ? 0 : Number(m[2])
  const frac = Number((m[3] ?? '').padEnd(2, '0'))
  const cents = whole * 100 + frac
  if (!Number.isSafeInteger(cents)) return null
  return m[1] ? -cents : cents
}

/** "8.25" → 825 bp. Up to two decimals of a percent. */
export function parsePercent(input: string | number | null | undefined): BasisPoints | null {
  // A percent with two decimals has exactly the shape of a money amount.
  return parseMoney(input)
}

/** 825 → "8.25" (trailing zeros trimmed: 800 → "8") */
export function bpToPercentString(bp: BasisPoints): string {
  return centsToPlain(bp).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

/** 123456 → "1234.56" (no symbol or grouping, for input fields) */
export function centsToPlain(cents: Cents): string {
  assertInt(cents, 'cents')
  const neg = cents < 0
  const a = Math.abs(cents)
  const s = `${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`
  return neg ? `-${s}` : s
}

/** 123456 → "$1,234.56" */
export function formatMoney(cents: Cents, currency = 'USD'): string {
  assertInt(cents, 'cents')
  const neg = cents < 0
  const a = Math.abs(cents)
  const whole = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const symbol = currency === 'USD' || currency === 'CAD' || currency === 'AUD' ? '$' : `${currency} `
  return `${neg ? '-' : ''}${symbol}${whole}.${String(a % 100).padStart(2, '0')}`
}

export function sumCents(values: Cents[]): Cents {
  let t = 0
  for (const v of values) {
    assertInt(v, 'cents')
    t += v
  }
  return t
}
