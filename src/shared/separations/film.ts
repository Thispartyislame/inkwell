/**
 * Film positives: one page per plate, art at exactly 100% size, centered, solid black, with
 * registration marks, center marks and a label outside the image area.
 * Each page is an SVG whose user unit is one point (viewBox in pt, width/height in inches).
 */
import { PAGE_SIZES_IN, type FilmOptions, type Plate } from './types'

export interface FilmPage {
  name: string
  svg: string
  width_in: number
  height_in: number
}

export interface FilmLayout {
  page_w: number
  page_h: number
  /** art's top-left on the page, in points */
  x: number
  y: number
  warnings: string[]
}

const MARK_GAP = 0.375 * 72 // registration marks sit this far outside the art
const MARK_R = 0.125 * 72

export function pageSizeIn(f: FilmOptions): [number, number] {
  return f.page === 'custom' ? [f.custom_w_in, f.custom_h_in] : PAGE_SIZES_IN[f.page]
}

export function filmLayout(artW: number, artH: number, f: FilmOptions): FilmLayout {
  const [wIn, hIn] = pageSizeIn(f)
  const page_w = wIn * 72
  const page_h = hIn * 72
  const warnings: string[] = []
  const needW = artW + (f.registration ? 2 * (MARK_GAP + MARK_R) : 0)
  const needH = artH + (f.registration ? 2 * (MARK_GAP + MARK_R) : 0) + (f.label ? 0.6 * 72 : 0)
  if (artW > page_w || artH > page_h) warnings.push(`The art (${(artW / 72).toFixed(2)}″ × ${(artH / 72).toFixed(2)}″) is bigger than the ${wIn}″ × ${hIn}″ film page.`)
  else if (needW > page_w || needH > page_h) warnings.push('The marks or label don’t all fit on this page size; pick a larger page.')
  if (artW > f.max_print_w_in * 72 || artH > f.max_print_h_in * 72) warnings.push(`The art is larger than your maximum print area (${f.max_print_w_in}″ × ${f.max_print_h_in}″).`)
  return { page_w, page_h, x: (page_w - artW) / 2, y: (page_h - artH) / 2, warnings }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function target(cx: number, cy: number, color: string): string {
  const r = MARK_R
  return `<g stroke="${color}" stroke-width="0.5" fill="none"><circle cx="${cx}" cy="${cy}" r="${r}"/><circle cx="${cx}" cy="${cy}" r="${r / 2}"/><path d="M${cx - r * 1.6} ${cy}H${cx + r * 1.6}M${cx} ${cy - r * 1.6}V${cy + r * 1.6}"/></g>`
}

export interface FilmLabel {
  job: string
  number: string
  location: string
  date: string
}

/** One film page for one plate. */
export function filmPage(plate: Plate, index: number, total: number, artW: number, artH: number, f: FilmOptions, label: FilmLabel): FilmPage {
  const L = filmLayout(artW, artH, f)
  const ink = f.invert ? '#ffffff' : '#000000'
  const parts: string[] = []
  if (f.invert) parts.push(`<rect x="0" y="0" width="${L.page_w}" height="${L.page_h}" fill="#000000"/>`)
  // the plate, at 100%: one SVG unit = one point
  parts.push(`<g transform="translate(${L.x.toFixed(3)} ${L.y.toFixed(3)})"><path d="${plate.d}" fill="${ink}" fill-rule="nonzero"/></g>`)
  const l = L.x
  const t = L.y
  const r = L.x + artW
  const b = L.y + artH
  const mx = L.x + artW / 2
  const my = L.y + artH / 2
  if (f.registration) {
    const g = MARK_GAP + MARK_R
    parts.push(target(mx, Math.max(MARK_R * 2, t - g), ink), target(mx, Math.min(L.page_h - MARK_R * 2, b + g), ink), target(Math.max(MARK_R * 2, l - g), my, ink), target(Math.min(L.page_w - MARK_R * 2, r + g), my, ink))
  }
  if (f.center_marks) {
    const len = 0.25 * 72
    parts.push(`<path stroke="${ink}" stroke-width="0.5" d="M${mx} 6v${len}M${mx} ${L.page_h - 6}v${-len}M6 ${my}h${len}M${L.page_w - 6} ${my}h${-len}"/>`)
  }
  let labelY = Math.min(L.page_h - 18, b + (f.registration ? MARK_GAP + MARK_R * 3 : 18) + 12)
  if (f.fill_bar) {
    // A solid strip to check exposure and ink density.
    parts.push(`<rect x="${(L.page_w / 2 - 72).toFixed(2)}" y="${Math.max(10, t - (f.registration ? MARK_GAP + MARK_R * 3 : 18) - 18).toFixed(2)}" width="144" height="10" fill="${ink}"/>`)
  }
  if (f.label) {
    const text = [label.job, label.number, `${plate.name}${plate.pms ? ` (${plate.pms})` : ''}`, `${index + 1} of ${total}`, label.location, label.date].filter(Boolean).join('  ·  ')
    labelY = Math.min(labelY, L.page_h - 10)
    parts.push(`<text x="${L.page_w / 2}" y="${labelY.toFixed(2)}" font-family="Helvetica, Arial, sans-serif" font-size="9" text-anchor="middle" fill="${ink}">${esc(text)}</text>`)
  }
  // Mirror for printing emulsion-side down: flip the whole film, label included.
  const body = f.mirror ? `<g transform="translate(${L.page_w} 0) scale(-1 1)">${parts.join('')}</g>` : parts.join('')
  const [wIn, hIn] = pageSizeIn(f)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wIn}in" height="${hIn}in" viewBox="0 0 ${L.page_w} ${L.page_h}">${f.invert ? '' : `<rect x="0" y="0" width="${L.page_w}" height="${L.page_h}" fill="#ffffff"/>`}${body}</svg>`
  return { name: `${String(index + 1).padStart(2, '0')}-${plate.name}`, svg, width_in: wIn, height_in: hIn }
}

export function filmPages(plates: Plate[], artW: number, artH: number, f: FilmOptions, label: FilmLabel): FilmPage[] {
  return plates.map((p, i) => filmPage(p, i, plates.length, artW, artH, f, label))
}
