// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lengthToPt, loadSvgArt } from '../../src/shared/separations/art'
import { deltaE } from '../../src/shared/separations/color'
import { filmLayout, filmPage } from '../../src/shared/separations/film'
import { autoMerge, buildPlates, defaultSettings, detectColors, resolveKey } from '../../src/shared/separations/plates'
import { DEFAULT_FILM, type SeparationSettings } from '../../src/shared/separations/types'

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '../fixtures/separations', name), 'utf8')
const near = (actual: number, expected: number, tol: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol)

function settings(art: ReturnType<typeof loadSvgArt>, over: Partial<SeparationSettings> = {}): SeparationSettings {
  const colors = detectColors(art)
  return { ...defaultSettings(art, colors, '#ffffff'), merge: {}, dropped: [], ...over }
}

describe('units and import', () => {
  it('reads physical sizes', () => {
    expect(lengthToPt('2in')).toBe(144)
    expect(lengthToPt('25.4mm')).toBeCloseTo(72)
    expect(lengthToPt('96px')).toBe(72)
    expect(lengthToPt('100')).toBe(75)
    expect(lengthToPt('50%')).toBeNull()
  })

  it('maps the viewBox to points with the art at the origin', () => {
    const art = loadSvgArt(fixture('three-color-logo.svg'))
    expect(art.width_pt).toBe(72)
    expect(art.height_pt).toBe(72)
    const red = art.shapes.find((s) => s.key === '#ff0000')!
    expect(red.path.bounds.x).toBeCloseTo(0)
    expect(red.path.bounds.width).toBeCloseTo(40)
  })

  it('scales to a new print width', () => {
    const art = loadSvgArt(fixture('three-color-logo.svg'), 144)
    expect(art.height_pt).toBe(144)
    expect(art.shapes[0].path.bounds.width).toBeCloseTo(80)
  })

  it('warns about live text and embedded images', () => {
    const art = loadSvgArt(fixture('dark-garment.svg'))
    const codes = art.warnings.map((w) => w.code)
    expect(codes).toContain('live_text')
    expect(codes).toContain('raster')
    expect(art.warnings.find((w) => w.code === 'live_text')!.message).toContain('“LIVE”')
    expect(art.warnings.find((w) => w.code === 'raster')!.message).toContain('10×10 at (50, 0)')
  })
})

describe('color detection', () => {
  it('finds each color with its visible area after knockout', () => {
    const art = loadSvgArt(fixture('three-color-logo.svg'))
    const colors = detectColors(art)
    const area = Object.fromEntries(colors.map((c) => [c.key, Math.round(c.area)]))
    expect(area).toEqual({ '#0000ff': 1575, '#ff0000': 1200, '#000000': 25, '#fe0101': 16 })
    expect(colors.reduce((t, c) => t + c.coverage_bp, 0)).toBeGreaterThanOrEqual(9999)
  })

  it('turns strokes into outlines', () => {
    const art = loadSvgArt(fixture('thin-strokes.svg'))
    const [c] = detectColors(art)
    // ring r 19..21 = 80π ≈ 251.3, plus a 60 × 0.5 line = 30
    near(c.area, 80 * Math.PI + 30, 2)
  })

  it('merges near-identical colors within the tolerance', () => {
    const art = loadSvgArt(fixture('three-color-logo.svg'))
    expect(deltaE('#ff0000', '#fe0101')).toBeLessThan(3)
    const merge = autoMerge(detectColors(art), 3)
    expect(merge).toEqual({ '#fe0101': '#ff0000' })
    expect(resolveKey('#fe0101', merge)).toBe('#ff0000')
  })
})

describe('plates', () => {
  it('knocks out lower colors: plates never overlap', () => {
    const art = loadSvgArt(fixture('three-color-logo.svg'))
    const { plates } = buildPlates(art, settings(art, { order: ['#ff0000', '#0000ff', '#000000'], merge: { '#fe0101': '#ff0000' }, underbase: { enabled: false, choke_pt: 0, exclude: [], highlight_white: false } }))
    expect(plates.map((p) => [p.key, Math.round(p.area)])).toEqual([
      ['#ff0000', 1216],
      ['#0000ff', 1575],
      ['#000000', 25]
    ])
  })

  it('an overprint color does not knock out what is under it', () => {
    const art = loadSvgArt(fixture('three-color-logo.svg'))
    const { plates } = buildPlates(art, settings(art, { order: ['#ff0000', '#0000ff', '#000000'], overprint: ['#000000'], underbase: { enabled: false, choke_pt: 0, exclude: [], highlight_white: false } }))
    expect(Math.round(plates.find((p) => p.key === '#0000ff')!.area)).toBe(1600)
    expect(plates.find((p) => p.key === '#000000')!.overprint).toBe(true)
  })

  it('dropped colors print nothing but still knock out', () => {
    const art = loadSvgArt(fixture('three-color-logo.svg'))
    const { plates } = buildPlates(art, settings(art, { order: ['#ff0000', '#0000ff'], dropped: ['#000000'], underbase: { enabled: false, choke_pt: 0, exclude: [], highlight_white: false } }))
    expect(plates.map((p) => p.key)).not.toContain('#000000')
    expect(Math.round(plates.find((p) => p.key === '#0000ff')!.area)).toBe(1575)
  })

  it('spreads colors printed after the first by the trap amount', () => {
    const art = loadSvgArt(fixture('three-color-logo.svg'))
    const base = { order: ['#ff0000', '#0000ff', '#000000'], underbase: { enabled: false, choke_pt: 0, exclude: [], highlight_white: false } }
    const { plates } = buildPlates(art, settings(art, { ...base, trap_pt: 1 }))
    // red prints first: not spread
    near(plates[0].area, 1200, 1)
    // blue 40×40 with a 5×5 hole, spread 1pt: (1600 + 160 + π) − 3×3
    near(plates[1].area, 1600 + 160 + Math.PI - 9, 2)
  })

  it('underbase is the union of printed colors, choked, and prints first', () => {
    const art = loadSvgArt(fixture('three-color-logo.svg'))
    const s = settings(art, { order: ['#ff0000', '#0000ff', '#000000'], merge: { '#fe0101': '#ff0000' }, underbase: { enabled: true, choke_pt: 0, exclude: [], highlight_white: false } })
    const unchoked = buildPlates(art, s).plates
    expect(unchoked[0].kind).toBe('underbase')
    near(unchoked[0].area, 1600 + 1600 - 400 + 16, 1)
    const choked = buildPlates(art, { ...s, underbase: { ...s.underbase, choke_pt: 1 } }).plates[0]
    // L-shaped union shrinks by about its perimeter (240) × 1pt; the 4×4 square loses 12
    near(choked.area, 2800 - 240 + 4 + 4, 8)
    const excluded = buildPlates(art, { ...s, underbase: { ...s.underbase, exclude: ['#0000ff'] } }).plates[0]
    near(excluded.area, 1216 + 25, 1)
  })

  it('dark garments: background drops, underbase on, lightest first, optional highlight white', () => {
    const art = loadSvgArt(fixture('dark-garment.svg'))
    const s = defaultSettings(art, detectColors(art), '#111111')
    expect(s.dropped).toEqual(['#000000'])
    expect(s.underbase.enabled).toBe(true)
    expect(s.order).toEqual(['#ffffff', '#ffd100'])
    const { plates } = buildPlates(art, s)
    expect(plates.map((p) => p.kind)).toEqual(['underbase', 'ink', 'ink'])
    const hl = buildPlates(art, { ...s, underbase: { ...s.underbase, highlight_white: true } }).plates
    expect(hl.map((p) => p.kind)).toEqual(['underbase', 'ink', 'highlight'])
  })

  it('turns gradients into halftone dots', () => {
    const art = loadSvgArt(fixture('gradient.svg'))
    const colors = detectColors(art)
    expect(colors[0].tone).toBe('gradient')
    const { plates } = buildPlates(art, defaultSettings(art, colors, '#ffffff'))
    expect(plates).toHaveLength(1)
    expect(plates[0].halftone).toBe(true)
    const dots = (plates[0].d.match(/M/g) ?? []).length
    // 2″ × 1″ at 50 lpi ≈ 5000 cells, minus the nearly white end
    expect(dots).toBeGreaterThan(3000)
    expect(dots).toBeLessThan(6000)
  })

  it('one-color text separates to one plate', () => {
    const art = loadSvgArt(fixture('one-color-text.svg'))
    const s = defaultSettings(art, detectColors(art), '#ffffff')
    const { plates } = buildPlates(art, s)
    expect(plates.map((p) => p.key)).toEqual(['#111111'])
  })
})

describe('films', () => {
  it('places the art at exactly 100% in the center of the page', () => {
    const art = loadSvgArt(fixture('three-color-logo.svg'))
    const { plates } = buildPlates(art, settings(art, { underbase: { enabled: false, choke_pt: 0, exclude: [], highlight_white: false } }))
    const page = filmPage(plates[0], 0, plates.length, art.width_pt, art.height_pt, { ...DEFAULT_FILM, page: 'tabloid' }, { job: 'Staff tees', number: 'Q-1001', location: 'Front', date: '2026-11-21' })
    expect(page.width_in).toBe(11)
    expect(page.height_in).toBe(17)
    // 1 SVG unit = 1 point: 11in ↔ 792 units
    expect(page.svg).toContain('width="11in" height="17in" viewBox="0 0 792 1224"')
    expect(page.svg).toContain(`translate(360.000 576.000)`)
    expect(page.svg).not.toMatch(/scale\((?!-1 1)/)
    expect(page.svg).toContain('fill="#000000" fill-rule="nonzero"')
    expect(page.svg).toContain('Staff tees  ·  Q-1001')
    expect(page.svg).toContain('1 of ')
  })

  it('mirrors and inverts', () => {
    const plate = { key: 'k', kind: 'ink' as const, name: 'Black', pms: '', hex: '#000', d: 'M0 0h10v10h-10z', area: 100, halftone: false, overprint: false }
    const m = filmPage(plate, 0, 1, 10, 10, { ...DEFAULT_FILM, page: 'letter', mirror: true }, { job: '', number: '', location: '', date: '' })
    expect(m.svg).toContain('translate(612 0) scale(-1 1)')
    const inv = filmPage(plate, 0, 1, 10, 10, { ...DEFAULT_FILM, page: 'letter', invert: true }, { job: '', number: '', location: '', date: '' })
    expect(inv.svg).toContain('fill="#ffffff" fill-rule="nonzero"')
  })

  it('warns when art is bigger than the page or the print area', () => {
    expect(filmLayout(12 * 72, 10 * 72, { ...DEFAULT_FILM, page: 'letter' }).warnings[0]).toMatch(/bigger than the 8.5″ × 11″/)
    expect(filmLayout(15 * 72, 10 * 72, { ...DEFAULT_FILM, page: 'custom', custom_w_in: 20, custom_h_in: 24 }).warnings.join()).toMatch(/maximum print area/)
    expect(filmLayout(4 * 72, 4 * 72, { ...DEFAULT_FILM, page: 'letter' }).warnings).toEqual([])
  })
})

describe('PDF / AI import', () => {
  it('reads vector paths, colors and strokes from a PDF page', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    // @ts-expect-error plain JS helper
    const { makePdf } = await import('../fixtures/separations/make-pdf.mjs')
    const { pdfToSvg } = await import('../../src/shared/separations/pdf')
    // red 40×40 at the top-left, blue 40×40 overlapping by 20×20, a 2pt black line, live text
    const pdf = makePdf('1 0 0 rg 0 32 40 40 re f\n0 0 1 rg 20 12 40 40 re f\n0 G 2 w 5 5 m 65 5 l S\nBT /F1 8 Tf 2 60 Td (Hi) Tj ET')
    const { svg } = await pdfToSvg(pdfjs as never, new Uint8Array(pdf))
    const art = loadSvgArt(svg)
    expect(art.width_pt).toBe(72)
    expect(art.warnings.map((w) => w.code)).toContain('live_text')
    const area = Object.fromEntries(detectColors(art).map((c) => [c.key, Math.round(c.area)]))
    expect(area).toEqual({ '#ff0000': 1200, '#0000ff': 1600, '#000000': 120 })
    // y is flipped: the red square is at the top-left in SVG space
    const red = art.shapes.find((s) => s.key === '#ff0000')!
    expect(red.path.bounds.y).toBeCloseTo(0)
  })
})

describe('garment changes', () => {
  it('re-applies garment defaults without losing other choices', async () => {
    const { withGarment } = await import('../../src/shared/separations/plates')
    const art = loadSvgArt(fixture('dark-garment.svg'))
    const colors = detectColors(art)
    const white = defaultSettings(art, colors, '#ffffff')
    expect(white.dropped).toEqual(['#ffffff'])
    expect(white.underbase.enabled).toBe(false)
    const black = withGarment({ ...white, trap_pt: 0.5 }, colors, '#111111')
    expect(black.dropped).toEqual(['#000000'])
    expect(black.underbase.enabled).toBe(true)
    expect(black.trap_pt).toBe(0.5)
    expect(withGarment(black, colors, '#ffffff').dropped).toEqual(['#ffffff'])
  })
})
