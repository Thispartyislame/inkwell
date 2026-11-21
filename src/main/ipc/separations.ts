import { execFile } from 'node:child_process'
import { BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { todayIso } from '@shared/dates'
import type { ApiImpl } from '@shared/ipc'
import { fileSafe } from '@shared/numbering'
import { SOURCE_EXTENSIONS, type FilmExport, type SourceKind } from '@shared/separations/job'
import { UserError } from '../db/errors'
import { addAttachment, getAttachment } from '../db/repos/attachments'
import { logActivity } from '../db/repos/activity'
import * as seps from '../db/repos/separations'
import { removeStoredFile, resolveInside, storeFile } from '../files/files'
import type { MainContext } from './handlers'

const run = promisify(execFile)

/** Find a program on PATH (or common install folders) without running a shell. */
function findTool(names: string[], extraDirs: string[] = []): string | null {
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), ...extraDirs].filter(Boolean)
  const exts = process.platform === 'win32' ? ['.exe', '.com', ''] : ['']
  for (const d of dirs) for (const n of names) for (const e of exts) {
    const p = path.join(d, n + e)
    try {
      if (fs.statSync(p).isFile()) return p
    } catch {
      // not here
    }
  }
  return null
}

export function detectTools(): { inkscape: string | null; ghostscript: string | null } {
  const win = process.platform === 'win32'
  const pf = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean) as string[]
  const inkDirs = win ? pf.map((p) => path.join(p, 'Inkscape', 'bin')) : process.platform === 'darwin' ? ['/Applications/Inkscape.app/Contents/MacOS', '/opt/homebrew/bin', '/usr/local/bin'] : []
  const gsDirs = win
    ? pf.flatMap((p) => {
        const root = path.join(p, 'gs')
        try {
          return fs.readdirSync(root).map((v) => path.join(root, v, 'bin'))
        } catch {
          return []
        }
      })
    : process.platform === 'darwin'
      ? ['/opt/homebrew/bin', '/usr/local/bin']
      : []
  return { inkscape: findTool(['inkscape'], inkDirs), ghostscript: findTool(win ? ['gswin64c', 'gswin32c', 'gs'] : ['gs'], gsDirs) }
}

/** EPS can't be read directly. Convert with the user's own Inkscape or Ghostscript if installed. */
async function convertEps(file: string): Promise<{ text?: string; base64?: string; tool: string }> {
  const tools = detectTools()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-eps-'))
  try {
    if (tools.inkscape) {
      const out = path.join(tmp, 'art.svg')
      await run(tools.inkscape, [file, '--export-type=svg', '--export-plain-svg', `--export-filename=${out}`], { timeout: 120_000 })
      return { text: fs.readFileSync(out, 'utf8'), tool: 'Inkscape' }
    }
    if (tools.ghostscript) {
      const out = path.join(tmp, 'art.pdf')
      await run(tools.ghostscript, ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dEPSCrop', '-sDEVICE=pdfwrite', `-sOutputFile=${out}`, file], { timeout: 120_000 })
      return { base64: fs.readFileSync(out).toString('base64'), tool: 'Ghostscript' }
    }
  } catch (e) {
    throw new UserError(`Couldn’t convert the EPS file: ${(e as Error).message.split('\n')[0]}. Re-save it as PDF or SVG instead.`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  throw new UserError('EPS files need Inkscape or Ghostscript installed on this computer to open. Without them, re-save the art as PDF (Illustrator: Save As → PDF) or SVG.')
}

/** Render one or more film SVG pages to a PDF at exact size (no margins, no scaling). */
async function filmsPdf(pages: FilmExport['pages']): Promise<Buffer> {
  if (!pages.length) throw new UserError('Nothing to export')
  const { width_in, height_in } = pages[0]
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${width_in}in ${height_in}in; margin: 0 }
    html, body { margin: 0; padding: 0; background: #fff }
    .page { width: ${width_in}in; height: ${height_in}in; overflow: hidden; break-after: page; page-break-after: always }
    .page:last-child { break-after: auto; page-break-after: auto }
    svg { display: block }
  </style></head><body>${pages.map((p) => `<div class="page">${p.svg}</div>`).join('')}</body></html>`
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-film-'))
  const file = path.join(tmp, 'film.html')
  fs.writeFileSync(file, html)
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } })
  try {
    await win.loadFile(file)
    return await win.webContents.printToPDF({ pageSize: { width: width_in, height: height_in }, margins: { top: 0, bottom: 0, left: 0, right: 0 }, printBackground: true, preferCSSPageSize: true })
  } finally {
    win.destroy()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

async function chooseFolder(ctx: MainContext, title: string): Promise<string | null> {
  const win = ctx.window()
  const opts: Electron.OpenDialogOptions = { title, properties: ['openDirectory', 'createDirectory'] }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
}

export function createSeparationHandlers(ctx: MainContext): Pick<ApiImpl, 'separations'> {
  const db = () => ctx.db
  const kindOf = (file: string): SourceKind => {
    const k = SOURCE_EXTENSIONS[path.extname(file).slice(1).toLowerCase()]
    if (!k) throw new UserError(`${path.basename(file)}: separations work from SVG, PDF, AI or EPS files`)
    return k
  }

  return {
    separations: {
      list: (owner) => seps.listSeparations(db(), owner),
      get: (id) => seps.getSeparation(db(), id),
      fromAttachment: (attachmentId) => {
        const a = getAttachment(db(), attachmentId)
        const owner = a.owner_type === 'quote' || a.owner_type === 'invoice' ? { type: a.owner_type, id: a.owner_id } : null
        return seps.createSeparation(db(), { rel_path: a.rel_path, name: a.original_name, kind: kindOf(a.original_name || a.rel_path), attachment_id: a.id, owner })
      },
      fromFile: async (paths, owner) => {
        let file = paths?.[0] ?? null
        if (!file) {
          const win = ctx.window()
          const opts: Electron.OpenDialogOptions = { title: 'Open artwork to separate', properties: ['openFile'], filters: [{ name: 'Vector artwork', extensions: ['svg', 'pdf', 'ai', 'eps'] }] }
          const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
          if (r.canceled || !r.filePaths[0]) return null
          file = r.filePaths[0]
        }
        const kind = kindOf(file)
        const st = fs.statSync(file, { throwIfNoEntry: false })
        if (!st?.isFile()) throw new UserError(`${path.basename(file)} isn’t a file`)
        if (st.size > 200 * 1024 * 1024) throw new UserError('That file is over 200 MB')
        if (owner) {
          // Keep it with the job's other artwork.
          const stored = storeFile(ctx.userData, file, `${owner.type}s/${owner.id}`)
          const a = addAttachment(db(), { owner_type: owner.type, owner_id: owner.id, kind: 'artwork', ...stored })
          return seps.createSeparation(db(), { rel_path: a.rel_path, name: a.original_name, kind, attachment_id: a.id, owner })
        }
        const stored = storeFile(ctx.userData, file, 'separations')
        return seps.createSeparation(db(), { rel_path: stored.rel_path, name: stored.original_name, kind, attachment_id: null, owner: null })
      },
      source: async (id) => {
        const j = seps.getSeparation(db(), id)
        const file = resolveInside(ctx.userData, j.source_rel_path)
        if (!fs.existsSync(file)) throw new UserError('The artwork file for this separation is missing')
        if (j.source_kind === 'svg') return { kind: 'svg', name: j.source_name, text: fs.readFileSync(file, 'utf8') }
        if (j.source_kind === 'eps') {
          const c = await convertEps(file)
          return { kind: 'eps', name: j.source_name, text: c.text, base64: c.base64, converted_with: c.tool }
        }
        const bytes = fs.readFileSync(file)
        if (j.source_kind === 'ai' && bytes.subarray(0, 5).toString('latin1') !== '%PDF-')
          throw new UserError('This .ai file was saved without PDF compatibility. In Illustrator, use Save As → check “Create PDF Compatible File”, or export as PDF or SVG.')
        return { kind: j.source_kind, name: j.source_name, base64: bytes.toString('base64') }
      },
      save: (id, data) => seps.saveSeparation(db(), id, data),
      remove: (id) => {
        const { files } = seps.deleteSeparation(db(), id)
        for (const f of files) removeStoredFile(ctx.userData, f)
      },
      exportFilms: async (id, data) => {
        const job = seps.getSeparation(db(), id)
        const base = fileSafe(`${job.name || 'separation'} films`, 60) || 'films'
        const owner = job.owner_type && job.owner_id ? { type: job.owner_type, id: job.owner_id } : null
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-out-'))
        let outPath: string | null = null
        let attachmentId: number | null = null
        try {
          if (data.mode === 'pdf') {
            const pdf = await filmsPdf(data.pages)
            const win = ctx.window()
            const opts: Electron.SaveDialogOptions = { title: 'Save films', defaultPath: `${base}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] }
            const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
            if (r.canceled || !r.filePath) return { path: null, job }
            fs.writeFileSync(r.filePath, pdf)
            outPath = r.filePath
            // Keep a copy with the job so it's linked to the imprint.
            const t = path.join(tmp, `${base}.pdf`)
            fs.writeFileSync(t, pdf)
            const stored = storeFile(ctx.userData, t, owner ? `${owner.type}s/${owner.id}` : 'separations')
            attachmentId = addAttachment(db(), { owner_type: owner?.type ?? 'separation', owner_id: owner?.id ?? id, kind: 'film', caption: `Films: ${job.name}`, ...stored }).id
          } else {
            const folder = await chooseFolder(ctx, data.mode === 'png' ? 'Choose a folder for the PNG films' : 'Choose a folder for the film PDFs')
            if (!folder) return { path: null, job }
            if (data.mode === 'pdfs') for (const p of data.pages) fs.writeFileSync(path.join(folder, `${base}_${fileSafe(p.name, 40)}.pdf`), await filmsPdf([p]))
            else for (const p of data.pngs ?? []) fs.writeFileSync(path.join(folder, `${base}_${fileSafe(p.name, 40)}.png`), Buffer.from(p.base64, 'base64'))
            outPath = folder
          }
          let thumbId: number | null = null
          if (data.thumbnail) {
            const t = path.join(tmp, `${base}_preview.png`)
            fs.writeFileSync(t, Buffer.from(data.thumbnail, 'base64'))
            const stored = storeFile(ctx.userData, t, owner ? `${owner.type}s/${owner.id}` : 'separations')
            thumbId = addAttachment(db(), { owner_type: owner?.type ?? 'separation', owner_id: owner?.id ?? id, kind: 'film', caption: `Separation preview: ${job.name}`, ...stored }).id
          }
          if (owner) logActivity(db(), owner.type, owner.id, 'films exported', { job: job.name, screens: data.pages.length })
          return { path: outPath, job: seps.setSeparationOutput(db(), id, { pdf_path: outPath, attachment_id: attachmentId, thumbnail_id: thumbId }) }
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true })
        }
      },
      link: (id, target) => seps.linkSeparation(db(), id, target, todayIso()),
      tools: () => detectTools()
    }
  }
}

