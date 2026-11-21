import type { DetectedColor, SeparationSettings } from './types'

export type SourceKind = 'svg' | 'pdf' | 'ai' | 'eps'

export interface SeparationJob {
  id: number
  name: string
  source_attachment_id: number | null
  source_rel_path: string
  source_name: string
  source_kind: SourceKind
  owner_type: 'quote' | 'invoice' | null
  owner_id: number | null
  /** number of the linked quote / invoice, for display */
  owner_number: string | null
  imprint_uid: string | null
  settings: SeparationSettings | null
  detected_colors: DetectedColor[]
  plate_count: number
  ink_count: number
  has_underbase: boolean
  output_pdf_path: string | null
  output_attachment_id: number | null
  thumbnail_attachment_id: number | null
  thumbnail_url: string
  created_at: string
  updated_at: string
}

export interface SeparationSource {
  kind: SourceKind
  name: string
  /** SVG text (svg, or eps converted with Inkscape) */
  text?: string
  /** base64 PDF bytes (pdf, ai, or eps converted with Ghostscript) */
  base64?: string
  converted_with?: string
}

export interface SeparationSave {
  name: string
  settings: SeparationSettings
  detected_colors: DetectedColor[]
  plate_count: number
  ink_count: number
  has_underbase: boolean
}

export interface FilmExport {
  pages: { name: string; svg: string; width_in: number; height_in: number }[]
  /** one PDF with a page per screen, one PDF per screen, or PNGs (rendered in the window) */
  mode: 'pdf' | 'pdfs' | 'png'
  pngs?: { name: string; base64: string }[]
  /** small composite preview, PNG base64, kept as the job's thumbnail */
  thumbnail?: string
}

export interface ImprintTarget {
  kind: 'quote' | 'invoice'
  id: number
  imprint_uid: string
}

export const SOURCE_EXTENSIONS: Record<string, SourceKind> = { svg: 'svg', pdf: 'pdf', ai: 'ai', eps: 'eps' }
