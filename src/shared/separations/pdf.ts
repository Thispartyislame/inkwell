/**
 * PDF (and PDF-compatible .ai) → SVG, using pdf.js (Apache-2.0) to read the page's drawing
 * operations. Vector paths keep their exact geometry and colors; live text, images and
 * shadings are reported, since they can't become spot-color films.
 */
import type { ArtWarning } from './types'

type Mat = [number, number, number, number, number, number]
const mul = (m: Mat, n: Mat): Mat => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]

interface GState {
  ctm: Mat
  fill: string
  stroke: string
  lineWidth: number
  fillAlpha: number
  strokeAlpha: number
  clip: string | null
}

/** The bits of the pdf.js module we use (main or legacy build). */
export interface PdfJsLike {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; disableFontFace?: boolean }): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ view: number[]; getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }> }> }> }
  OPS: Record<string, number>
}

export async function pdfToSvg(pdfjs: PdfJsLike, data: Uint8Array, pageNumber = 1): Promise<{ svg: string; warnings: ArtWarning[]; pages: number }> {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise
  const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages))
  const [x0, y0, x1, y1] = page.view
  const W = x1 - x0
  const H = y1 - y0
  const ol = await page.getOperatorList()
  const OP = pdfjs.OPS
  const name: Record<number, string> = {}
  for (const [k, v] of Object.entries(OP)) name[v] = k

  const out: string[] = []
  const clips: string[] = []
  const warnings: ArtWarning[] = []
  let text = 0
  let images: number[][] = []
  let shadings = 0
  let st: GState = { ctm: [1, 0, 0, 1, 0, 0], fill: '#000000', stroke: '#000000', lineWidth: 1, fillAlpha: 1, strokeAlpha: 1, clip: null }
  const stack: GState[] = []
  let pendingClip: { d: string; evenodd: boolean } | null = null

  // page space (y up) → SVG space (y down, origin at the page's top-left)
  const pt = (x: number, y: number): [number, number] => {
    const m = st.ctm
    const X = m[0] * x + m[2] * y + m[4]
    const Y = m[1] * x + m[3] * y + m[5]
    return [X - x0, H - (Y - y0)]
  }
  const f = (n: number) => (Math.round(n * 1000) / 1000).toString()

  const pathD = (ops: ArrayLike<number>): string => {
    const parts: string[] = []
    for (let i = 0; i < ops.length; ) {
      const op = ops[i++]
      if (op === 0 || op === 1) {
        const [x, y] = pt(ops[i++], ops[i++])
        parts.push(`${op === 0 ? 'M' : 'L'}${f(x)} ${f(y)}`)
      } else if (op === 2) {
        const a = pt(ops[i++], ops[i++])
        const b = pt(ops[i++], ops[i++])
        const c = pt(ops[i++], ops[i++])
        parts.push(`C${f(a[0])} ${f(a[1])} ${f(b[0])} ${f(b[1])} ${f(c[0])} ${f(c[1])}`)
      } else if (op === 3) {
        const a = pt(ops[i++], ops[i++])
        const b = pt(ops[i++], ops[i++])
        parts.push(`Q${f(a[0])} ${f(a[1])} ${f(b[0])} ${f(b[1])}`)
      } else if (op === 4) parts.push('Z')
      else break
    }
    return parts.join('')
  }

  const scale = () => Math.sqrt(Math.abs(st.ctm[0] * st.ctm[3] - st.ctm[1] * st.ctm[2])) || 1
  const clipAttr = () => (st.clip ? ` clip-path="url(#${st.clip})"` : '')

  for (let i = 0; i < ol.fnArray.length; i++) {
    const op = name[ol.fnArray[i]]
    const args = ol.argsArray[i] as unknown[]
    switch (op) {
      case 'save':
        stack.push({ ...st })
        break
      case 'restore':
        st = stack.pop() ?? st
        break
      case 'transform':
        st.ctm = mul(st.ctm, args as Mat)
        break
      case 'setFillRGBColor':
        st.fill = String(args[0])
        break
      case 'setStrokeRGBColor':
        st.stroke = String(args[0])
        break
      case 'setLineWidth':
        st.lineWidth = Number(args[0])
        break
      case 'setGState':
        for (const [k, v] of (args[0] as [string, unknown][]) ?? []) {
          if (k === 'ca') st.fillAlpha = Number(v)
          if (k === 'CA') st.strokeAlpha = Number(v)
          if (k === 'LW') st.lineWidth = Number(v)
        }
        break
      case 'setFillColorN':
      case 'shadingFill':
        shadings++
        break
      case 'showText':
      case 'showSpacedText':
      case 'nextLineShowText':
      case 'nextLineSetSpacingShowText':
        text++
        break
      case 'paintImageXObject':
      case 'paintInlineImageXObject':
      case 'paintImageMaskXObject':
      case 'paintImageXObjectRepeat': {
        const a = pt(0, 0)
        const b = pt(1, 1)
        images.push([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])])
        break
      }
      case 'clip':
      case 'eoClip':
        // applies to the next path, which is usually painted with endPath
        pendingClip = { d: '', evenodd: op === 'eoClip' }
        break
      case 'constructPath': {
        const paint = name[args[0] as number]
        const ops = (args[1] as ArrayLike<number>[])[0] ?? []
        const d = pathD(ops)
        if (!d) break
        if (pendingClip) {
          const id = `c${clips.length}`
          clips.push(`<clipPath id="${id}"><path d="${d}"${pendingClip.evenodd ? ' clip-rule="evenodd"' : ''}/></clipPath>`)
          st.clip = id
          pendingClip = null
        }
        const fills = /fill/i.test(paint ?? '')
        const strokes = /stroke/i.test(paint ?? '')
        const eo = /eoFill/i.test(paint ?? '')
        if (fills) out.push(`<path d="${d}" fill="${st.fill}"${st.fillAlpha < 1 ? ` fill-opacity="${st.fillAlpha}"` : ''}${eo ? ' fill-rule="evenodd"' : ''}${clipAttr()}/>`)
        if (strokes) out.push(`<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${f(st.lineWidth * scale())}"${st.strokeAlpha < 1 ? ` stroke-opacity="${st.strokeAlpha}"` : ''}${clipAttr()}/>`)
        break
      }
    }
  }
  images = images.filter((r) => r[2] > 0.5 && r[3] > 0.5)

  // The same checks the SVG importer does, phrased for PDF content.
  const svgImages = images.map((r) => `<image x="${f(r[0])}" y="${f(r[1])}" width="${f(r[2])}" height="${f(r[3])}" href="data:,"/>`).join('')
  const svgText = text ? `<text x="0" y="0" font-family="(from PDF)">${text} text run${text === 1 ? '' : 's'}</text>` : ''
  if (shadings) warnings.push({ code: 'unsupported', message: `${shadings} gradient or pattern fill${shadings === 1 ? '' : 's'} in the PDF can’t be read yet; they’re left off the films. Export the art as SVG to halftone gradients.` })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}pt" height="${f(H)}pt" viewBox="0 0 ${f(W)} ${f(H)}"><defs>${clips.join('')}</defs>${out.join('')}${svgImages}${svgText}</svg>`
  return { svg, warnings, pages: doc.numPages }
}
