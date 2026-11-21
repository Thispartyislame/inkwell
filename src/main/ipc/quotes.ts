import type Database from 'better-sqlite3'
import { dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { todayIso } from '@shared/dates'
import { quoteDocument, type CustomerDocument } from '@shared/documents'
import { ATTACHMENT_EXTENSIONS, fileUrl, IMAGE_MIME } from '@shared/files'
import type { ApiImpl } from '@shared/ipc'
import { documentFileName } from '@shared/numbering'
import { UserError } from '../db/errors'
import { addAttachment, deleteAttachmentRow, getAttachment, listAttachments, updateAttachment } from '../db/repos/attachments'
import * as quotes from '../db/repos/quotes'
import { getSettings } from '../db/repos/settings'
import { removeStoredFile, resolveInside, storeFile } from '../files/files'
import { renderPdf } from '../pdf/render'
import type { MainContext } from './handlers'

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024

export function buildQuoteDocument(db: Database.Database, id: number, today = todayIso()): CustomerDocument {
  const detail = quotes.getQuoteDetail(db, id, today)
  const settings = getSettings(db)
  const column_labels: Record<string, string> = {}
  detail.breakdown.lines.forEach((l) => l.imprints.forEach((i) => (column_labels[i.uid] = i.column_label)))
  return quoteDocument({
    quote: detail.quote,
    customer: detail.customer,
    breakdown: detail.breakdown,
    settings,
    logo_url: fileUrl(settings.logo_path),
    images: detail.attachments.filter((a) => a.include_in_pdf && IMAGE_MIME.test(a.mime)).map((a) => ({ url: fileUrl(a.rel_path), caption: a.caption })),
    column_labels
  })
}

export function createQuoteHandlers(ctx: MainContext): ApiImpl['quotes'] {
  const db = () => ctx.db
  const today = () => todayIso()

  /** Copy a quote's files to a new quote (revise / duplicate / reorder), so each owns its files. */
  const copyAttachments = (fromId: number, toId: number) => {
    for (const a of listAttachments(db(), 'quote', fromId)) {
      try {
        const stored = storeFile(ctx.userData, resolveInside(ctx.userData, a.rel_path), `quotes/${toId}`)
        addAttachment(db(), { owner_type: 'quote', owner_id: toId, kind: a.kind, caption: a.caption, include_in_pdf: a.include_in_pdf, ...stored, original_name: a.original_name })
      } catch (err) {
        console.error('[quotes] could not copy attachment', a.id, err)
      }
    }
  }

  const fileFor = (id: number) => {
    const d = quotes.getQuoteDetail(db(), id, today())
    return { detail: d, name: documentFileName([d.quote.number, d.customer?.display_name, d.quote.job_name]) }
  }

  const writePdf = async (id: number): Promise<{ buffer: Buffer; name: string }> => {
    const { name } = fileFor(id)
    const buffer = await renderPdf(buildQuoteDocument(db(), id, today()))
    const dir = path.join(ctx.userData, 'pdfs')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, name), buffer)
    return { buffer, name }
  }

  return {
    list: (f) => quotes.listQuotes(db(), f ?? {}),
    get: (id) => quotes.getQuoteDetail(db(), id, today()),
    create: (opts) => quotes.createQuote(db(), opts ?? {}, today()),
    save: (input) => quotes.saveQuote(db(), input, today()),
    pricingBase: () => quotes.livePricingBase(db()),
    markSent: (id) => (quotes.markSent(db(), id, today()), quotes.getQuoteDetail(db(), id, today())),
    approve: (id, by) => (quotes.approveQuote(db(), id, by ?? '', today()), quotes.getQuoteDetail(db(), id, today())),
    decline: (id, reason) => (quotes.declineQuote(db(), id, reason ?? ''), quotes.getQuoteDetail(db(), id, today())),
    revise: (id) => {
      const q = quotes.reviseQuote(db(), id, today())
      copyAttachments(id, q.id)
      return q
    },
    duplicate: (id) => {
      const q = quotes.duplicateQuote(db(), id, today())
      copyAttachments(id, q.id)
      return q
    },
    reorder: (id) => {
      const q = quotes.duplicateQuote(db(), id, today(), true)
      copyAttachments(id, q.id)
      return q
    },
    archive: (id) => (quotes.setQuoteArchived(db(), id, true), quotes.getQuoteDetail(db(), id, today())),
    restore: (id) => (quotes.setQuoteArchived(db(), id, false), quotes.getQuoteDetail(db(), id, today())),

    addAttachments: async (quoteId, paths) => {
      quotes.loadQuote(db(), quoteId)
      let files = paths
      if (!files) {
        const win = ctx.window()
        const opts: Electron.OpenDialogOptions = { title: 'Add mockups or artwork', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images and artwork', extensions: [...ATTACHMENT_EXTENSIONS] }] }
        const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
        if (r.canceled) return []
        files = r.filePaths
      }
      const added = []
      for (const p of files.slice(0, 50)) {
        const ext = path.extname(p).slice(1).toLowerCase()
        if (!(ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext)) throw new UserError(`${path.basename(p)}: only images, PDF, AI, EPS, PSD and TIFF files can be attached`)
        const st = fs.statSync(p, { throwIfNoEntry: false })
        if (!st?.isFile()) throw new UserError(`${path.basename(p)} isn’t a file`)
        if (st.size > MAX_ATTACHMENT_BYTES) throw new UserError(`${path.basename(p)} is over 100 MB`)
        const stored = storeFile(ctx.userData, p, `quotes/${quoteId}`)
        const isImage = IMAGE_MIME.test(stored.mime)
        added.push(addAttachment(db(), { owner_type: 'quote', owner_id: quoteId, kind: isImage ? 'mockup' : 'artwork', include_in_pdf: isImage, ...stored }))
      }
      return added
    },
    updateAttachment: (id, patch) => updateAttachment(db(), id, patch ?? {}),
    deleteAttachment: (id) => {
      const a = getAttachment(db(), id)
      if (a.owner_type !== 'quote') throw new UserError('Not a quote attachment')
      deleteAttachmentRow(db(), id)
      removeStoredFile(ctx.userData, a.rel_path)
    },

    document: (id) => buildQuoteDocument(db(), id, today()),
    savePdf: async (id) => {
      const { name } = fileFor(id)
      const win = ctx.window()
      const opts: Electron.SaveDialogOptions = { title: 'Save quote PDF', defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (r.canceled || !r.filePath) return null
      const { buffer } = await writePdf(id)
      fs.writeFileSync(r.filePath, buffer)
      return r.filePath
    },
    openPdf: async (id) => {
      const { name } = await writePdf(id)
      const file = path.join(ctx.userData, 'pdfs', name)
      const err = await shell.openPath(file)
      if (err) throw new UserError(`The PDF was saved to ${file} but couldn’t be opened: ${err}`)
      return file
    }
  }
}
