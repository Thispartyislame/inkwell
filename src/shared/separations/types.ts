/** Spot-color separation: shapes, settings and plates. All geometry is in points (1/72 inch). */

export interface ArtWarning {
  code: 'raster' | 'mostly_raster' | 'live_text' | 'unsupported' | 'gradient' | 'empty' | 'size_unknown'
  message: string
}

/** A color found in the art (after strokes are turned into outlines). */
export interface DetectedColor {
  key: string
  hex: string
  /** visible area in square points, after upper shapes knock out lower ones */
  area: number
  /** share of all visible inked area, in basis points */
  coverage_bp: number
  /** gradients and see-through fills become halftones (beta) */
  tone: 'solid' | 'gradient' | 'tint'
}

export interface InkAssignment {
  name: string
  pms: string
  hex: string
}

export interface FilmOptions {
  page: 'letter' | 'tabloid' | '13x19' | 'custom'
  custom_w_in: number
  custom_h_in: number
  mirror: boolean
  invert: boolean
  registration: boolean
  center_marks: boolean
  fill_bar: boolean
  label: boolean
  /** largest print area your press/platens take, for a warning */
  max_print_w_in: number
  max_print_h_in: number
  png_dpi: number
}

export interface SeparationSettings {
  /** physical width of the art; height follows the aspect ratio */
  art_width_pt: number
  garment_hex: string
  /** colorKey → colorKey it is merged into */
  merge: Record<string, string>
  /** colors left unprinted (garment shows through); they still knock out what's below */
  dropped: string[]
  /** ink for each remaining color */
  inks: Record<string, InkAssignment>
  /** print order of remaining colors (underbase is always first) */
  order: string[]
  /** colors that print on top without knocking out the colors beneath */
  overprint: string[]
  /** spread for colors printed after the first, in points */
  trap_pt: number
  underbase: { enabled: boolean; choke_pt: number; exclude: string[]; highlight_white: boolean }
  halftone: { lpi: number; angle: number; shape: 'round' | 'ellipse' }
  film: FilmOptions
  /** label details printed on each film */
  label: { job: string; number: string; location: string }
}

export interface Plate {
  key: string
  kind: 'underbase' | 'ink' | 'highlight'
  name: string
  pms: string
  /** ink color, for the composite preview */
  hex: string
  /** SVG path data in art points (origin at the art's top-left), even-odd fill */
  d: string
  area: number
  halftone: boolean
  overprint: boolean
}

export const PAGE_SIZES_IN: Record<Exclude<FilmOptions['page'], 'custom'>, [number, number]> = {
  letter: [8.5, 11],
  tabloid: [11, 17],
  '13x19': [13, 19]
}

export const DEFAULT_FILM: FilmOptions = {
  page: 'tabloid',
  custom_w_in: 13,
  custom_h_in: 19,
  mirror: false,
  invert: false,
  registration: true,
  center_marks: true,
  fill_bar: false,
  label: true,
  max_print_w_in: 14,
  max_print_h_in: 16,
  png_dpi: 720
}
