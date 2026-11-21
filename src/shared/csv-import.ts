/**
 * Turn rows from a supplier or hand-made CSV into catalog garments.
 *
 * Handles both common shapes:
 *  - one row per SKU (style + color + size + price), as distributor price lists come, and
 *  - one row per style with a sizes column ("S,M,L,XL,2XL" or a range "S-3XL").
 * Rows are grouped by brand + style number (or name when there's no style number).
 */
import { colorFromName } from './colors'
import { parseMoney } from './money'
import type { GarmentColor, GarmentInput } from './schemas'
import { GARMENT_CATEGORIES } from './schemas'
import { normalizeSize, SIZE_GROUPS, sizeGroup, sortSizes, STANDARD_SIZES, YOUTH_SIZES, type SizeGroup } from './sizes'

export const CSV_FIELDS = ['brand', 'style_number', 'name', 'color', 'sizes', 'cost', 'category'] as const
export type CsvField = (typeof CSV_FIELDS)[number]
export const CSV_FIELD_LABELS: Record<CsvField, string> = {
  brand: 'Brand',
  style_number: 'Style number',
  name: 'Name / description',
  color: 'Color',
  sizes: 'Size or sizes',
  cost: 'Cost per piece',
  category: 'Category (optional)'
}
/** column header for each field, or null when not mapped */
export type CsvMapping = Record<CsvField, string | null>

const HINTS: Record<CsvField, RegExp> = {
  brand: /^(brand|brand ?name|mill|manufacturer|mfr)$/i,
  style_number: /^(style|style ?(#|no\.?|number|id|code)|item ?(#|number)|sku ?style)$/i,
  name: /^(name|description|title|style ?name|product ?name|item ?name)$/i,
  color: /^(color|colou?r ?name|colorway)$/i,
  sizes: /^(sizes?|size ?name|size ?range|available ?sizes)$/i,
  cost: /^(cost|price|piece ?price|case ?price|your ?price|customer ?price|net ?price|wholesale)$/i,
  category: /^(category|type|product ?type)$/i
}

/** Guess the mapping from header names. */
export function guessMapping(headers: string[]): CsvMapping {
  const m = Object.fromEntries(CSV_FIELDS.map((f) => [f, null])) as CsvMapping
  for (const f of CSV_FIELDS) m[f] = headers.find((h) => HINTS[f].test(h.trim())) ?? null
  return m
}

const ALL_SIZES: string[] = [...YOUTH_SIZES, ...STANDARD_SIZES, '6XL']

/** "S,M,L" / "S / M / L" / "S-3XL" / "XL" → normalized sizes */
export function parseSizes(raw: string): string[] {
  const s = raw.trim()
  if (!s) return []
  const range = /^([A-Za-z0-9]+)\s*(?:-|–|to)\s*([A-Za-z0-9]+)$/.exec(s)
  if (range) {
    const a = ALL_SIZES.indexOf(normalizeSize(range[1]))
    const b = ALL_SIZES.indexOf(normalizeSize(range[2]))
    if (a !== -1 && b !== -1 && a <= b) return ALL_SIZES.slice(a, b + 1)
  }
  return s
    .split(/[,;/|]+|\s{2,}/)
    .map((x) => normalizeSize(x))
    .filter(Boolean)
}

function guessCategory(raw: string, name: string): GarmentInput['category'] {
  const s = `${raw} ${name}`.toLowerCase()
  const direct = GARMENT_CATEGORIES.find((c) => raw.trim().toLowerCase().replace(/[\s-]+/g, '_') === c)
  if (direct) return direct
  if (/hood|pullover|zip/.test(s)) return 'hoodie'
  if (/crew ?neck|sweatshirt/.test(s)) return 'crewneck'
  if (/long ?sleeve|\bls\b/.test(s)) return 'long_sleeve'
  if (/\bcap\b|\bhat\b|beanie|trucker|snapback/.test(s)) return 'hat'
  if (/tote|bag/.test(s)) return 'tote'
  if (/polo/.test(s)) return 'polo'
  if (/jacket|windbreaker|vest/.test(s)) return 'jacket'
  if (/tee|t-shirt|shirt|tank/.test(s)) return 'tee'
  return 'other'
}

export interface CsvGroupResult {
  garments: GarmentInput[]
  errors: { row: number; message: string }[]
}

export function groupCsvRows(rows: Record<string, string>[], mapping: CsvMapping): CsvGroupResult {
  const errors: CsvGroupResult['errors'] = []
  const get = (r: Record<string, string>, f: CsvField) => (mapping[f] ? String(r[mapping[f]!] ?? '').trim() : '')
  interface Acc {
    g: GarmentInput
    colors: Map<string, GarmentColor>
    sizes: Set<string>
    costs: Partial<Record<SizeGroup, number>>
  }
  const groups = new Map<string, Acc>()

  rows.forEach((r, i) => {
    const rowNo = i + 2 // header is row 1
    const brand = get(r, 'brand')
    const style = get(r, 'style_number')
    const name = get(r, 'name') || [brand, style].filter(Boolean).join(' ')
    if (!name && !style) {
      if (Object.values(r).some((v) => String(v ?? '').trim())) errors.push({ row: rowNo, message: 'No name or style number' })
      return
    }
    const key = `${brand.toLowerCase()}|${(style || name).toLowerCase()}`
    let acc = groups.get(key)
    if (!acc) {
      acc = {
        g: {
          brand,
          style_number: style,
          name: name || style,
          category: guessCategory(get(r, 'category'), name),
          supplier: 'other',
          supplier_other: '',
          colors: [],
          sizes: [],
          cost_base_cents: 0,
          cost_2xl_cents: 0,
          cost_3xl_cents: 0,
          cost_4xl_plus_cents: 0,
          notes: '',
          active: true
        },
        colors: new Map(),
        sizes: new Set(),
        costs: {}
      }
      groups.set(key, acc)
    }
    const color = get(r, 'color')
    if (color && !acc.colors.has(color.toLowerCase())) acc.colors.set(color.toLowerCase(), colorFromName(color))
    const sizes = parseSizes(get(r, 'sizes'))
    sizes.forEach((s) => acc!.sizes.add(s))
    const costRaw = get(r, 'cost')
    if (costRaw) {
      const c = parseMoney(costRaw)
      if (c === null || c < 0) errors.push({ row: rowNo, message: `Couldn’t read cost “${costRaw}”` })
      else {
        const groupsInRow = sizes.length ? [...new Set(sizes.map(sizeGroup))] : (['base'] as SizeGroup[])
        // Keep the highest cost seen per group, so one cheap SKU doesn't under-price the group.
        for (const sg of groupsInRow) acc.costs[sg] = Math.max(acc.costs[sg] ?? 0, c)
      }
    }
  })

  const garments = [...groups.values()].map(({ g, colors, sizes, costs }) => {
    // A group with no cost of its own falls back to the next smaller group's cost.
    let prev = 0
    const filled: Record<SizeGroup, number> = { base: 0, '2xl': 0, '3xl': 0, '4xl_plus': 0 }
    for (const sg of SIZE_GROUPS) {
      filled[sg] = costs[sg] ?? prev
      prev = filled[sg]
    }
    return {
      ...g,
      colors: [...colors.values()],
      sizes: sortSizes([...sizes]),
      cost_base_cents: filled.base,
      cost_2xl_cents: filled['2xl'],
      cost_3xl_cents: filled['3xl'],
      cost_4xl_plus_cents: filled['4xl_plus']
    }
  })
  return { garments, errors }
}
