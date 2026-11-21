import { dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { todayIso } from '@shared/dates'
import { ATTACHMENT_EXTENSIONS, IMAGE_MIME } from '@shared/files'
import type { ApiImpl } from '@shared/ipc'
import { UserError } from '../db/errors'
import { addAttachment, deleteAttachmentRow, getAttachment, listAttachments, updateAttachment } from '../db/repos/attachments'
import * as invoices from '../db/repos/invoices'
import * as payments from '../db/repos/payments'
import * as quotes from '../db/repos/quotes'
import { buildDocument, writeDocumentPdf } from '../documents'
import { compose, prepareManualEmail, sendDocument, sendTestEmail } from '../email/email'
import { removeStoredFile, resolveInside, storeFile } from '../files/files'
import type { MainContext } from './handlers'

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024

type DocHandlers = Pick<ApiImpl, 'quotes' | 'invoices' | 'payments' | 'attachments' | 'documents' | 'email'>

/** Handlers for quotes, invoices, payments, their files, PDFs and email. */
export function createDocumentHandlers(ctx: MainContext): DocHandlers {
  const db = () => ctx.db
  const today = () => todayIso()

  /** Copy a document's files to another (revise / duplicate / reorder / convert), so each owns its files. */
  const copyAttachments = (from: { type: 'quote' | 'invoice'; id: number }, to: { type: 'quote' | 'invoice'; id: number }) => {
    for (const a of listAttachments(db(), from.type, from.id)) {
      try {
        const stored = storeFile(ctx.userData, resolveInside(ctx.userData, a.rel_path), `${to.type}s/${to.id}`)
        addAttachment(db(), { owner_type: to.type, owner_id: to.id, kind: a.kind, caption: a.caption, include_in_pdf: a.include_in_pdf, ...stored, original_name: a.original_name })
      } catch (err) {
        console.error('[attachments] could not copy', a.id, err)
      }
    }
  }
  const quoteDetail = (id: number) => quotes.getQuoteDetail(db(), id, today())
  const invoiceDetail = (id: number) => invoices.getInvoiceDetail(db(), id, today())

  return {
    quotes: {
      list: (f) => quotes.listQuotes(db(), f ?? {}),
      get: quoteDetail,
      create: (opts) => quotes.createQuote(db(), opts ?? {}, today()),
      save: (input) => quotes.saveQuote(db(), input, today()),
      pricingBase: () => quotes.livePricingBase(db()),
      markSent: (id) => (quotes.markSent(db(), id, today()), quoteDetail(id)),
      approve: (id, by) => (quotes.approveQuote(db(), id, by ?? '', today()), quoteDetail(id)),
      decline: (id, reason) => (quotes.declineQuote(db(), id, reason ?? ''), quoteDetail(id)),
      revise: (id) => {
        const q = quotes.reviseQuote(db(), id, today())
        copyAttachments({ type: 'quote', id }, { type: 'quote', id: q.id })
        return q
      },
      duplicate: (id) => {
        const q = quotes.duplicateQuote(db(), id, today())
        copyAttachments({ type: 'quote', id }, { type: 'quote', id: q.id })
        return q
      },
      reorder: (id) => {
        const q = quotes.duplicateQuote(db(), id, today(), true)
        copyAttachments({ type: 'quote', id }, { type: 'quote', id: q.id })
        return q
      },
      archive: (id) => (quotes.setQuoteArchived(db(), id, true), quoteDetail(id)),
      restore: (id) => (quotes.setQuoteArchived(db(), id, false), quoteDetail(id)),
      convert: (id) => {
        const inv = invoices.convertQuote(db(), id, today())
        copyAttachments({ type: 'quote', id }, { type: 'invoice', id: inv.id })
        return inv
      }
    },

    invoices: {
      list: (f) => invoices.listInvoices(db(), { today: today(), ...(f ?? {}) }),
      get: invoiceDetail,
      create: (opts) => invoices.createInvoice(db(), opts ?? {}, today()),
      save: (input) => invoices.saveInvoice(db(), input, today()),
      markSent: (id) => (invoices.markInvoiceSent(db(), id, today()), invoiceDetail(id)),
      void: (id, reason) => (invoices.voidInvoice(db(), id, reason ?? ''), invoiceDetail(id)),
      reprice: (id) => (invoices.repriceInvoice(db(), id, today()), invoiceDetail(id)),
      archive: (id) => (invoices.setInvoiceArchived(db(), id, true), invoiceDetail(id)),
      restore: (id) => (invoices.setInvoiceArchived(db(), id, false), invoiceDetail(id))
    },

    payments: {
      record: (input) => payments.recordPayment(db(), input),
      void: (id, reason) => payments.voidPayment(db(), id, reason ?? '')
    },

    attachments: {
      add: async (ownerType, ownerId, paths) => {
        if (ownerType === 'quote') quotes.loadQuote(db(), ownerId)
        else if (ownerType === 'invoice') invoices.loadInvoice(db(), ownerId)
        else throw new UserError('Unknown owner')
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
          const stored = storeFile(ctx.userData, p, `${ownerType}s/${ownerId}`)
          const isImage = IMAGE_MIME.test(stored.mime)
          added.push(addAttachment(db(), { owner_type: ownerType, owner_id: ownerId, kind: isImage ? 'mockup' : 'artwork', include_in_pdf: isImage, ...stored }))
        }
        return added
      },
      update: (id, patch) => updateAttachment(db(), id, patch ?? {}),
      remove: (id) => {
        const a = getAttachment(db(), id)
        if (a.owner_type !== 'quote' && a.owner_type !== 'invoice') throw new UserError('That file can’t be removed here')
        deleteAttachmentRow(db(), id)
        removeStoredFile(ctx.userData, a.rel_path)
      }
    },

    documents: {
      preview: (kind, id) => buildDocument(db(), kind, id, today()).doc,
      savePdf: async (kind, id) => {
        const { fileName } = buildDocument(db(), kind, id, today())
        const win = ctx.window()
        const opts: Electron.SaveDialogOptions = { title: 'Save PDF', defaultPath: fileName, filters: [{ name: 'PDF', extensions: ['pdf'] }] }
        const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
        if (r.canceled || !r.filePath) return null
        const { buffer } = await writeDocumentPdf(db(), ctx.userData, kind, id, today())
        fs.writeFileSync(r.filePath, buffer)
        return r.filePath
      },
      openPdf: async (kind, id) => {
        const { file } = await writeDocumentPdf(db(), ctx.userData, kind, id, today())
        const err = await shell.openPath(file)
        if (err) throw new UserError(`The PDF was saved to ${file} but couldn’t be opened: ${err}`)
        return file
      }
    },

    email: {
      compose: (kind, id) => compose(db(), kind, id, today()),
      send: (input) => sendDocument(db(), ctx.userData, input, today()),
      prepareManual: (input) => prepareManualEmail(db(), ctx.userData, input, today()),
      test: (to) => sendTestEmail(db(), to)
    }
  }
}
