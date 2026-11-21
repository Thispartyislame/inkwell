import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { loadSvgArt, type Art } from '@shared/separations/art'
import { pdfToSvg, type PdfJsLike } from '@shared/separations/pdf'
import type { SeparationSource } from '@shared/separations/job'
import type { ArtWarning } from '@shared/separations/types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface LoadedArt {
  /** SVG text the art was read from (PDF/AI/EPS are converted), for the "original" preview */
  svg: string
  art: Art
  warnings: ArtWarning[]
  note: string
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Turn a stored source (SVG, PDF, AI, EPS-converted) into SVG text. */
export async function sourceToSvg(src: SeparationSource): Promise<{ svg: string; warnings: ArtWarning[]; note: string }> {
  if (src.text) return { svg: src.text, warnings: [], note: src.converted_with ? `Converted from EPS with ${src.converted_with}.` : '' }
  if (!src.base64) throw new Error('The artwork file is empty')
  const r = await pdfToSvg(pdfjs as unknown as PdfJsLike, b64ToBytes(src.base64))
  const note = [src.converted_with ? `Converted from EPS with ${src.converted_with}.` : '', r.pages > 1 ? `The file has ${r.pages} pages; separating page 1.` : ''].filter(Boolean).join(' ')
  return { svg: r.svg, warnings: r.warnings, note }
}

export function loadArt(svg: string, widthPt?: number, extra: ArtWarning[] = [], note = ''): LoadedArt {
  const art = loadSvgArt(svg, widthPt)
  return { svg, art, warnings: [...extra, ...art.warnings], note }
}

/** Render SVG text to a PNG (base64), optionally forced to pure black and white (no gray edges). */
export async function svgToPng(svg: string, widthPx: number, heightPx: number, threshold: boolean): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('Couldn’t draw the film'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(widthPx)
    canvas.height = Math.round(heightPx)
    const ctx = canvas.getContext('2d', { willReadFrequently: threshold })!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    if (threshold) {
      // Films are pure black or clear: snap anti-aliased edge pixels to one or the other.
      const rows = 512
      for (let y = 0; y < canvas.height; y += rows) {
        const h = Math.min(rows, canvas.height - y)
        const data = ctx.getImageData(0, y, canvas.width, h)
        const d = data.data
        for (let i = 0; i < d.length; i += 4) {
          const v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 128 ? 0 : 255
          d[i] = d[i + 1] = d[i + 2] = v
          d[i + 3] = 255
        }
        ctx.putImageData(data, 0, y)
      }
    }
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG export failed'))), 'image/png'))
    const buf = new Uint8Array(await blob.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    canvas.width = canvas.height = 0
    return btoa(bin)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Largest PNG side Chromium canvases handle reliably. */
export const MAX_PNG_SIDE = 16384
export const MAX_PNG_PIXELS = 150_000_000
