/**
 * Load vector art into paper.js as a flat list of filled shapes in paint order, in points.
 * Strokes are expanded to outlines. Needs a DOM (the app's renderer, or jsdom in tests).
 */
import paper from 'paper'
import { PaperOffset } from 'paperjs-offset'
import { rgbToHex } from './color'
import type { ArtWarning } from './types'

export interface Shape {
  path: paper.PathItem
  /** solid color key (#rrggbb) or a gradient key */
  key: string
  hex: string
  tone: 'solid' | 'gradient' | 'tint'
  /** 0..1 ink coverage for tints */
  opacity: number
  gradient: { stops: { hex: string; offset: number }[]; origin: paper.Point; destination: paper.Point; radial: boolean } | null
}

export interface Art {
  scope: paper.PaperScope
  shapes: Shape[]
  width_pt: number
  height_pt: number
  /** size from the file before any override */
  natural_width_pt: number
  warnings: ArtWarning[]
}

const UNIT_PT: Record<string, number> = { in: 72, mm: 72 / 25.4, cm: 72 / 2.54, pt: 1, pc: 12, px: 0.75, '': 0.75 }

/** "2in" → 144; "50mm" → 141.7; "300" (px) → 225. null when missing or a percentage. */
export function lengthToPt(v: string | null): number | null {
  if (!v) return null
  const m = /^\s*([\d.]+)\s*(in|mm|cm|pt|pc|px)?\s*$/i.exec(v)
  if (!m) return null
  return Number(m[1]) * UNIT_PT[(m[2] ?? '').toLowerCase()]
}

function colorHex(c: paper.Color): string {
  return rgbToHex({ r: c.red * 255, g: c.green * 255, b: c.blue * 255 })
}

/** Parse and clean an SVG string; collect warnings about text, images and unsupported content. */
function inspect(svgText: string): { svg: string; vb: [number, number, number, number]; width_pt: number; height_pt: number; warnings: ArtWarning[]; rasterRects: number[][] } {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('This file isn’t a valid SVG')
  const warnings: ArtWarning[] = []
  const vbAttr = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  const wAttr = lengthToPt(root.getAttribute('width'))
  const hAttr = lengthToPt(root.getAttribute('height'))
  let vb: [number, number, number, number]
  if (vbAttr.length === 4 && vbAttr.every(Number.isFinite) && vbAttr[2] > 0 && vbAttr[3] > 0) vb = vbAttr as [number, number, number, number]
  else vb = [0, 0, (wAttr ?? 600) / 0.75, (hAttr ?? 600) / 0.75]
  let width_pt = wAttr ?? (hAttr ? (hAttr * vb[2]) / vb[3] : vb[2] * 0.75)
  if (!wAttr && !hAttr) warnings.push({ code: 'size_unknown', message: 'The file doesn’t say how big the art is. Check the print width before making films.' })
  const height_pt = (width_pt * vb[3]) / vb[2]
  if (!Number.isFinite(width_pt) || width_pt <= 0) width_pt = 288

  const texts = [...root.getElementsByTagName('text')]
  if (texts.length) {
    const fonts = [...new Set(texts.map((t) => t.getAttribute('font-family') || (t.getAttribute('style') ?? '').match(/font-family:\s*([^;]+)/)?.[1] || 'unknown font'))]
    const sample = texts.map((t) => (t.textContent ?? '').trim()).filter(Boolean).slice(0, 3).map((s) => `“${s.slice(0, 30)}”`).join(', ')
    warnings.push({ code: 'live_text', message: `${texts.length} live text item${texts.length === 1 ? '' : 's'} (${sample}; ${fonts.join(', ')}) won’t print. Convert text to outlines in your design program and re-import.` })
    texts.forEach((t) => t.remove())
  }
  const rasterRects: number[][] = []
  const images = [...root.getElementsByTagName('image')]
  for (const img of images) {
    const n = (a: string) => Number(img.getAttribute(a) ?? 0) || 0
    rasterRects.push([n('x'), n('y'), n('width'), n('height')])
    img.remove()
  }
  if (images.length) warnings.push({ code: 'raster', message: `${images.length} embedded image${images.length === 1 ? '' : 's'} can’t be separated as vectors: ${rasterRects.map((r) => `${Math.round(r[2])}×${Math.round(r[3])} at (${Math.round(r[0])}, ${Math.round(r[1])})`).join('; ')}. Those areas are left off the films.` })
  for (const tag of ['filter', 'mask', 'pattern', 'foreignObject']) {
    const n = root.getElementsByTagName(tag).length
    if (n) warnings.push({ code: 'unsupported', message: `${n} ${tag} element${n === 1 ? '' : 's'} ignored; flatten ${tag === 'mask' ? 'masks' : tag === 'filter' ? 'effects' : tag + 's'} in your design program for exact films.` })
  }
  // paper.js reads the viewBox; drop width/height so it doesn't rescale to screen pixels.
  root.removeAttribute('width')
  root.removeAttribute('height')
  root.setAttribute('viewBox', vb.join(' '))
  return { svg: new XMLSerializer().serializeToString(root), vb, width_pt, height_pt, warnings, rasterRects }
}

function isFilled(c: paper.Color | null): c is paper.Color {
  return !!c && (c.type === 'gradient' || c.alpha > 0.01)
}

/**
 * Import SVG text. `widthPt` overrides the physical width (height keeps the aspect ratio).
 */
export function loadSvgArt(svgText: string, widthPt?: number): Art {
  const info = inspect(svgText)
  const scope = new paper.PaperScope()
  scope.setup(new scope.Size(1, 1))
  scope.activate()
  const root = scope.project.importSVG(info.svg, { expandShapes: true, insert: false, applyMatrix: true }) as paper.Item
  const width_pt = widthPt && widthPt > 0 ? widthPt : info.width_pt
  const s = width_pt / info.vb[2]
  // viewBox → points. paper.js already moves the viewBox origin to (0, 0); only scale here.
  const toPt = new scope.Matrix(s, 0, 0, s, 0, 0)
  const shapes: Shape[] = []

  const visit = (item: paper.Item, opacity: number, clip: paper.PathItem | null) => {
    if (!item.visible) return
    const op = opacity * (item.opacity ?? 1)
    if (op <= 0.01) return
    if (item instanceof scope.Group || item instanceof scope.Layer) {
      let mask = clip
      const kids = [...item.children]
      if ((item as paper.Group).clipped && kids.length && kids[0] instanceof scope.PathItem) {
        const m = (kids.shift() as paper.PathItem).clone({ insert: false }) as paper.PathItem
        m.transform(toPt)
        mask = mask ? (mask.intersect(m, { insert: false }) as paper.PathItem) : m
      }
      for (const k of kids) visit(k, op, mask)
      return
    }
    if (!(item instanceof scope.Path || item instanceof scope.CompoundPath)) return
    const p = item as paper.PathItem
    const add = (geom: paper.PathItem, color: paper.Color, alpha: number) => {
      geom.transform(toPt)
      if (clip) geom = geom.intersect(clip, { insert: false }) as paper.PathItem
      if (Math.abs((geom as unknown as { area: number }).area) < 0.01) return
      if (color.type === 'gradient') {
        const g = color.gradient
        const stops = g.stops.map((st) => ({ hex: colorHex(st.color), offset: st.offset ?? 0 }))
        const darkest = [...stops].sort((a, b) => luminanceOf(a.hex) - luminanceOf(b.hex))[0].hex
        shapes.push({
          path: geom,
          key: `gradient:${darkest}`,
          hex: darkest,
          tone: 'gradient',
          opacity: alpha,
          gradient: { stops, origin: (color as unknown as { origin: paper.Point }).origin.transform(toPt), destination: (color as unknown as { destination: paper.Point }).destination.transform(toPt), radial: !!g.radial }
        })
        return
      }
      const hex = colorHex(color)
      const a = alpha * color.alpha
      shapes.push({ path: geom, key: a < 0.97 ? `tint:${hex}:${Math.round(a * 100)}` : hex, hex, tone: a < 0.97 ? 'tint' : 'solid', opacity: a, gradient: null })
    }
    if (isFilled(p.fillColor)) {
      const fill = p.clone({ insert: false }) as paper.PathItem
      fill.fillRule = p.fillRule
      add(fill, p.fillColor, op)
    }
    if (isFilled(p.strokeColor) && p.strokeWidth > 0) {
      // Strokes print as filled outlines.
      const outline = PaperOffset.offsetStroke(p as paper.Path, p.strokeWidth / 2, { cap: (p.strokeCap as 'butt' | 'round') ?? 'butt', join: (p.strokeJoin as 'miter' | 'round' | 'bevel') ?? 'miter', insert: false }) as unknown as paper.PathItem
      if (outline) add(outline, p.strokeColor, op)
    }
  }
  visit(root, 1, null)

  const warnings = [...info.warnings]
  if (shapes.some((x) => x.tone === 'gradient')) warnings.push({ code: 'gradient', message: 'Gradients will be printed as halftones (beta). Check the film before burning screens.' })
  const artArea = width_pt * width_pt * (info.vb[3] / info.vb[2])
  const rasterArea = info.rasterRects.reduce((t, r) => t + r[2] * r[3] * s * s, 0)
  if (rasterArea > artArea * 0.5)
    warnings.unshift({ code: 'mostly_raster', message: 'This art is mostly a raster image (a photo or flattened artwork). Spot-color films need vector art; ask for the original vector file (AI, PDF or SVG) instead of separating this.' })
  if (!shapes.length) warnings.push({ code: 'empty', message: 'No printable vector shapes were found in this file.' })
  return { scope, shapes, width_pt, height_pt: (width_pt * info.vb[3]) / info.vb[2], natural_width_pt: info.width_pt, warnings }
}

function luminanceOf(hex: string): number {
  const v = parseInt(hex.slice(1), 16)
  return 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)
}
