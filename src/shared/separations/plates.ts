/**
 * From shapes to plates: detect colors, merge/drop them, knock out, trap, underbase, halftone.
 */
import paper from 'paper'
import { PaperOffset } from 'paperjs-offset'
import type { Art, Shape } from './art'
import { deltaE, hexToRgb, isNearWhite, lightness, rgbToHex } from './color'
import { DEFAULT_FILM, type DetectedColor, type InkAssignment, type Plate, type SeparationSettings } from './types'

type Region = paper.PathItem


function unite(a: Region | undefined, b: Region): Region {
  return a ? (a.unite(b, { insert: false }) as Region) : (b.clone({ insert: false }) as Region)
}

/**
 * Visible region of each color: shapes are painted in order and each one knocks out what is
 * beneath it, unless its color overprints. Dropped colors (null) still knock out.
 * Tones (gradients/tints) are kept apart from solid areas of the same ink, as `${key}#tone`.
 */
function visibleRegions(art: Art, resolve: (s: Shape) => string | null, overprint: Set<string>): Map<string, Region> {
  art.scope.activate()
  const reg = new Map<string, Region>()
  for (const shape of art.shapes) {
    const target = resolve(shape)
    const sub = target && shape.tone !== 'solid' ? `${target}#tone` : target
    const over = target !== null && overprint.has(target)
    if (!over) {
      const b = shape.path.bounds
      for (const [k, r] of reg) {
        if (k === sub || !r.bounds.intersects(b)) continue
        reg.set(k, r.subtract(shape.path, { insert: false }) as Region)
      }
    }
    if (sub) reg.set(sub, unite(reg.get(sub), shape.path))
  }
  return reg
}

/** paper.js has `area` on paths at runtime; its type definitions only declare it on Path. */
const areaOf = (r: Region | undefined) => (r ? Math.abs((r as unknown as { area: number }).area) : 0)

/** Every distinct color in the art, with how much of the design it covers. */
export function detectColors(art: Art): DetectedColor[] {
  const reg = visibleRegions(art, (s) => s.key, new Set())
  const byKey = new Map<string, DetectedColor>()
  for (const s of art.shapes) if (!byKey.has(s.key)) byKey.set(s.key, { key: s.key, hex: s.hex, area: 0, coverage_bp: 0, tone: s.tone })
  for (const c of byKey.values()) c.area = areaOf(reg.get(c.key)) + areaOf(reg.get(`${c.key}#tone`))
  const total = [...byKey.values()].reduce((t, c) => t + c.area, 0) || 1
  for (const c of byKey.values()) c.coverage_bp = Math.round((c.area / total) * 10000)
  return [...byKey.values()].filter((c) => c.area > 0.5).sort((a, b) => b.area - a.area)
}

/** Merge near-identical colors: each color joins the biggest similar color within `tolerance` ΔE. */
export function autoMerge(colors: DetectedColor[], tolerance: number): Record<string, string> {
  const kept: DetectedColor[] = []
  const merge: Record<string, string> = {}
  for (const c of [...colors].sort((a, b) => b.area - a.area)) {
    const into = kept.find((k) => k.tone === c.tone && deltaE(k.hex, c.hex) <= tolerance)
    if (into) merge[c.key] = into.key
    else kept.push(c)
  }
  return merge
}

/** Follow merge links to the color a key finally prints as. */
export function resolveKey(key: string, merge: Record<string, string>): string {
  const seen = new Set<string>()
  let k = key
  while (merge[k] && !seen.has(k)) {
    seen.add(k)
    k = merge[k]
  }
  return k
}

export interface InkLike {
  name: string
  pms: string
  hex: string
}

/** Sensible starting settings for new art on a garment color. */
export function defaultSettings(art: Art, colors: DetectedColor[], garmentHex: string, inks: InkLike[] = []): SeparationSettings {
  const merge = autoMerge(colors, 6)
  const remaining = colors.filter((c) => !merge[c.key])
  // The garment color (and colors indistinguishable from it) shows through instead of printing.
  const dropped = remaining.filter((c) => c.tone === 'solid' && deltaE(c.hex, garmentHex) < 6).map((c) => c.key)
  const printed = remaining.filter((c) => !dropped.includes(c.key))
  const assign: Record<string, InkAssignment> = {}
  for (const c of printed) {
    const near = inks.map((i) => ({ i, d: deltaE(i.hex, c.hex) })).sort((a, b) => a.d - b.d)[0]
    assign[c.key] = near && near.d <= 12 ? { name: near.i.name, pms: near.i.pms, hex: near.i.hex } : { name: c.tone === 'gradient' ? `Halftone ${c.hex}` : c.hex.toUpperCase(), pms: '', hex: c.hex }
  }
  return {
    art_width_pt: art.width_pt,
    garment_hex: garmentHex,
    merge,
    dropped,
    inks: assign,
    order: [...printed].sort((a, b) => lightness(b.hex) - lightness(a.hex)).map((c) => c.key),
    overprint: [],
    trap_pt: 0,
    underbase: { enabled: lightness(garmentHex) < 50, choke_pt: 0.75, exclude: [], highlight_white: false },
    halftone: { lpi: 50, angle: 22.5, shape: 'round' },
    film: { ...DEFAULT_FILM },
    label: { job: '', number: '', location: '' }
  }
}

/** Offset a region outward (spread, positive) or inward (choke, negative). */
export function offsetRegion(r: Region, pt: number): Region {
  if (!pt || areaOf(r) === 0) return r
  const out = PaperOffset.offset(r as unknown as paper.Path, pt, { join: 'round', insert: false }) as unknown as Region
  return out ?? r
}

// ---------- halftones (beta) ----------
function toneAt(shapes: Shape[], p: paper.Point): number | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]
    if (!s.path.bounds.contains(p) || !s.path.contains(p)) continue
    if (!s.gradient) return s.opacity
    const g = s.gradient
    let t: number
    if (g.radial) t = p.getDistance(g.origin) / Math.max(1e-6, g.destination.getDistance(g.origin))
    else {
      const v = g.destination.subtract(g.origin)
      t = p.subtract(g.origin).dot(v) / Math.max(1e-6, v.dot(v))
    }
    t = Math.max(0, Math.min(1, t))
    const stops = g.stops
    let a = stops[0]
    let b = stops[stops.length - 1]
    for (let k = 0; k < stops.length - 1; k++) if (t >= stops[k].offset && t <= stops[k + 1].offset) [a, b] = [stops[k], stops[k + 1]]
    const f = b.offset > a.offset ? (t - a.offset) / (b.offset - a.offset) : 0
    const ca = hexToRgb(a.hex)
    const cb = hexToRgb(b.hex)
    const hex = rgbToHex({ r: ca.r + (cb.r - ca.r) * f, g: ca.g + (cb.g - ca.g) * f, b: ca.b + (cb.b - ca.b) * f })
    // Darker = more ink, relative to the darkest stop.
    const darkest = Math.min(...stops.map((x) => lightness(x.hex)))
    return Math.max(0, Math.min(1, ((100 - lightness(hex)) / Math.max(1, 100 - darkest)) * s.opacity))
  }
  return null
}

export const MAX_DOTS = 150_000

/** Halftone dots for a tone region: a rotated grid at `lpi`, dot area proportional to ink coverage. */
export function halftone(scope: paper.PaperScope, region: Region, shapes: Shape[], hs: SeparationSettings['halftone']): { d: string; dots: number; truncated: boolean } {
  const cell = 72 / Math.max(10, hs.lpi)
  const rad = (hs.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const b = region.bounds
  const cx = b.center.x
  const cy = b.center.y
  const half = Math.hypot(b.width, b.height) / 2 + cell
  const parts: string[] = []
  let dots = 0
  for (let u = -half; u <= half; u += cell) {
    for (let v = -half; v <= half; v += cell) {
      const x = cx + u * cos - v * sin
      const y = cy + u * sin + v * cos
      const p = new scope.Point(x, y)
      if (!b.contains(p) || !region.contains(p)) continue
      const cov = toneAt(shapes, p)
      if (cov === null || cov < 0.02) continue
      if (dots >= MAX_DOTS) return { d: parts.join(''), dots, truncated: true }
      dots++
      // dot area = coverage × cell area (capped so dots stay round-ish)
      const r = Math.min(cell * 0.72, Math.sqrt((Math.min(cov, 1) * cell * cell) / Math.PI))
      const rx = hs.shape === 'ellipse' ? r * 1.25 : r
      const ry = hs.shape === 'ellipse' ? r * 0.8 : r
      // a closed ellipse as two arcs, clockwise
      parts.push(`M${(x - rx).toFixed(2)} ${y.toFixed(2)}a${rx.toFixed(2)} ${ry.toFixed(2)} 0 1 0 ${(2 * rx).toFixed(2)} 0a${rx.toFixed(2)} ${ry.toFixed(2)} 0 1 0 ${(-2 * rx).toFixed(2)} 0z`)
    }
  }
  return { d: parts.join(''), dots, truncated: false }
}

const pathData = (r: Region | undefined) => (r && areaOf(r) > 0 ? r.pathData : '')

export interface PlateResult {
  plates: Plate[]
  warnings: string[]
}

/** Build the films' content: one plate per screen, in print order (underbase first). */
export function buildPlates(art: Art, s: SeparationSettings): PlateResult {
  art.scope.activate()
  const dropped = new Set(s.dropped)
  const resolve = (sh: Shape) => {
    const k = resolveKey(sh.key, s.merge)
    return dropped.has(k) ? null : k
  }
  const reg = visibleRegions(art, resolve, new Set(s.overprint))
  const warnings: string[] = []
  const keys = [...new Set(art.shapes.map(resolve).filter((k): k is string => !!k))]
  const order = [...s.order.filter((k) => keys.includes(k)), ...keys.filter((k) => !s.order.includes(k))]

  const plates: Plate[] = []
  let firstInkSeen = false
  for (const key of order) {
    const solid = reg.get(key)
    const tone = reg.get(`${key}#tone`)
    if (!areaOf(solid) && !areaOf(tone)) continue
    const ink = s.inks[key] ?? { name: key, pms: '', hex: key.startsWith('#') ? key : '#000000' }
    // Colors printed after the first are spread so small registration shifts don't show gaps.
    let solidOut = solid
    if (solid && firstInkSeen && s.trap_pt > 0) solidOut = offsetRegion(solid, s.trap_pt)
    firstInkSeen = true
    let d = pathData(solidOut)
    if (tone && areaOf(tone)) {
      const toneShapes = art.shapes.filter((sh) => resolve(sh) === key && sh.tone !== 'solid')
      const h = halftone(art.scope, tone, toneShapes, s.halftone)
      if (h.truncated) warnings.push(`${ink.name}: halftone stopped at ${MAX_DOTS.toLocaleString()} dots; lower the LPI or reduce the gradient area.`)
      d += h.d
    }
    plates.push({ key, kind: 'ink', name: ink.name, pms: ink.pms, hex: ink.hex, d, area: areaOf(solidOut) + areaOf(tone), halftone: !!areaOf(tone), overprint: s.overprint.includes(key) })
  }

  if (s.underbase.highlight_white) {
    const whites = plates.filter((p) => p.kind === 'ink' && isNearWhite(p.hex))
    for (const w of whites) {
      plates.splice(plates.indexOf(w), 1)
      plates.push({ ...w, kind: 'highlight', name: `${w.name} (highlight)` })
    }
  }

  if (s.underbase.enabled) {
    // White under everything that prints, choked so it doesn't peek out at the edges.
    let base: Region | undefined
    for (const [k, r] of reg) {
      const key = k.replace(/#tone$/, '')
      if (s.underbase.exclude.includes(key) || !areaOf(r)) continue
      base = unite(base, r)
    }
    if (base) {
      const choked = offsetRegion(base, -Math.abs(s.underbase.choke_pt))
      if (areaOf(choked) > 0) plates.unshift({ key: 'underbase', kind: 'underbase', name: 'Underbase white', pms: '', hex: '#f4f4f4', d: pathData(choked), area: areaOf(choked), halftone: false, overprint: false })
    }
  }
  if (!plates.length) warnings.push('Nothing left to print: every color is dropped or merged away.')
  return { plates, warnings }
}


/**
 * Change the garment color and re-apply its defaults: colors matching the old garment print
 * again, colors matching the new one drop out (the shirt shows through), and the underbase is
 * on for dark garments. Other choices are kept.
 */
export function withGarment(s: SeparationSettings, colors: DetectedColor[], hex: string): SeparationSettings {
  const matches = (c: DetectedColor | undefined, g: string) => !!c && c.tone === 'solid' && deltaE(c.hex, g) < 6
  const byKey = new Map(colors.map((c) => [c.key, c]))
  const kept = s.dropped.filter((k) => !matches(byKey.get(k), s.garment_hex))
  const add = colors.filter((c) => !s.merge[c.key] && matches(c, hex) && !kept.includes(c.key)).map((c) => c.key)
  return { ...s, garment_hex: hex, dropped: [...kept, ...add], underbase: { ...s.underbase, enabled: lightness(hex) < 50 } }
}
