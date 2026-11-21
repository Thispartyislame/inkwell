/** Garment sizes and the cost/price groups they fall into. */

export const SIZE_GROUPS = ['base', '2xl', '3xl', '4xl_plus'] as const
export type SizeGroup = (typeof SIZE_GROUPS)[number]

export const SIZE_GROUP_LABELS: Record<SizeGroup, string> = {
  base: 'S–XL',
  '2xl': '2XL',
  '3xl': '3XL',
  '4xl_plus': '4XL+'
}

/** Adult sizes in display order. */
export const STANDARD_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'] as const
export const YOUTH_SIZES = ['YXS', 'YS', 'YM', 'YL', 'YXL'] as const

const ALIASES: Record<string, string> = {
  XXL: '2XL',
  XXXL: '3XL',
  XXXXL: '4XL',
  XXXXXL: '5XL',
  '2X': '2XL',
  '3X': '3XL',
  '4X': '4XL',
  '5X': '5XL',
  '6X': '6XL',
  SM: 'S',
  SMALL: 'S',
  MD: 'M',
  MED: 'M',
  MEDIUM: 'M',
  LG: 'L',
  LARGE: 'L',
  XLARGE: 'XL',
  'X-LARGE': 'XL',
  'X-SMALL': 'XS'
}

/** Normalize a size label from a CSV or user input: "xxl" → "2XL", " m " → "M". */
export function normalizeSize(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '')
  return ALIASES[s] ?? s
}

/** Which price/cost group a size belongs to. Unknown and youth sizes count as base. */
export function sizeGroup(size: string): SizeGroup {
  const s = normalizeSize(size)
  if (s === '2XL' || s === '2XLT' || s === 'XLT2') return '2xl'
  if (s === '3XL' || s === '3XLT') return '3xl'
  const m = /^(\d+)XL/.exec(s)
  if (m && Number(m[1]) >= 4) return '4xl_plus'
  return 'base'
}

/** Sort sizes in natural garment order; unknown sizes go last in their original order. */
export function sortSizes(sizes: string[]): string[] {
  const order: string[] = [...YOUTH_SIZES, ...STANDARD_SIZES, '6XL']
  const rank = (s: string) => {
    const i = order.indexOf(normalizeSize(s))
    return i === -1 ? order.length : i
  }
  return sizes.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s)
}
