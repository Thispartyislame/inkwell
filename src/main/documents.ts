import type Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { invoiceDocument, quoteDocument, receiptDocument, type CustomerDocument } from '@shared/documents'
import { fileUrl, IMAGE_MIME } from '@shared/files'
import { formatDate } from '@shared/dates'
import type { MergeField } from '@shared/merge-fields'
import { formatMoney } from '@shared/money'
import { documentFileName } from '@shared/numbering'
import type { QuoteBreakdown } from '@shared/pricing/types'
import type { Attachment } from '@shared/schemas'
import { customerSummary } from './db/repos/docstore'
import { getInvoiceDetail, loadInvoice } from './db/repos/invoices'
import { getPayment, paidOn } from './db/repos/payments'
import { getQuoteDetail, loadQuote } from './db/repos/quotes'
import { getSettings } from './db/repos/settings'
import { renderPdf } from './pdf/render'

export type DocumentKind = 'quote' | 'invoice' | 'receipt'

export interface BuiltDocument {
  doc: CustomerDocument
  fileName: string
  /** for email templates and the To: field */
  merge: Partial<Record<MergeField, string>>
  customerId: number | null
  emails: string[]
}

const images = (atts: Attachment[]) => atts.filter((a) => a.include_in_pdf && IMAGE_MIME.test(a.mime)).map((a) => ({ url: fileUrl(a.rel_path), caption: a.caption }))
const columnLabels = (b: QuoteBreakdown) => {
  const out: Record<string, string> = {}
  b.lines.forEach((l) => l.imprints.forEach((i) => (out[i.uid] = i.column_label)))
  return out
}

function contactEmails(db: Database.Database, customerId: number | null): string[] {
  if (!customerId) return []
  const c = customerSummary(db, customerId)
  const contacts = db.prepare(`SELECT email FROM customer_contacts WHERE customer_id = ? AND email <> ''`).all(customerId) as { email: string }[]
  return [...new Set([c?.email ?? '', ...contacts.map((k) => k.email)].filter(Boolean))]
}

export function buildDocument(db: Database.Database, kind: DocumentKind, id: number, today: string): BuiltDocument {
  const s = getSettings(db)
  const money = (c: number) => formatMoney(c, s.currency)
  const logo_url = fileUrl(s.logo_path)
  const base = { shop_name: s.shop_name }

  if (kind === 'quote') {
    const d = getQuoteDetail(db, id, today)
    const doc = quoteDocument({ quote: d.quote, customer: d.customer, breakdown: d.breakdown, settings: s, logo_url, images: images(d.attachments), column_labels: columnLabels(d.breakdown), payments: d.payments })
    return {
      doc,
      fileName: documentFileName([d.quote.number, d.customer?.display_name, d.quote.job_name]),
      merge: { ...base, customer_first_name: d.customer?.first_name ?? '', customer_name: d.customer?.display_name ?? '', quote_number: d.quote.number, job_name: d.quote.job_name, total: money(d.breakdown.total_cents), expiration_date: formatDate(d.quote.expires_on) },
      customerId: d.quote.customer_id,
      emails: contactEmails(db, d.quote.customer_id)
    }
  }

  if (kind === 'invoice') {
    const d = getInvoiceDetail(db, id, today)
    const doc = invoiceDocument({ invoice: d.invoice, customer: d.customer, breakdown: d.breakdown, settings: s, logo_url, images: images(d.attachments), payments: d.payments, source_quote_number: d.source_quote?.number ?? null, column_labels: columnLabels(d.breakdown) })
    return {
      doc,
      fileName: documentFileName([d.invoice.number, d.customer?.display_name]),
      merge: { ...base, customer_first_name: d.customer?.first_name ?? '', customer_name: d.customer?.display_name ?? '', invoice_number: d.invoice.number, job_name: d.invoice.job_name, total: money(d.invoice.total_cents), balance_due: money(d.invoice.balance_cents), due_date: formatDate(d.invoice.due_on) },
      customerId: d.invoice.customer_id,
      emails: contactEmails(db, d.invoice.customer_id)
    }
  }

  const p = getPayment(db, id)
  const customer = customerSummary(db, p.customer_id)
  let applied: Parameters<typeof receiptDocument>[0]['applied']
  if (p.invoice_id) {
    const inv = loadInvoice(db, p.invoice_id)
    applied = { kind: 'invoice', number: inv.number, job_name: inv.job_name, total_cents: inv.total_cents, paid_cents: inv.paid_cents }
  } else {
    const q = loadQuote(db, p.quote_id!)
    applied = { kind: 'quote', number: q.number, job_name: q.job_name, total_cents: q.total_cents, paid_cents: paidOn(db, { quote_id: q.id }) }
  }
  return {
    doc: receiptDocument({ payment: p, customer, settings: s, logo_url, applied }),
    fileName: documentFileName([p.receipt_number, customer?.display_name]),
    merge: { ...base, customer_first_name: customer?.first_name ?? '', customer_name: customer?.display_name ?? '', receipt_number: p.receipt_number, amount: money(p.amount_cents), invoice_number: applied.kind === 'invoice' ? applied.number : '', quote_number: applied.kind === 'quote' ? applied.number : '', job_name: applied.job_name, balance_due: money(applied.total_cents - applied.paid_cents) },
    customerId: p.customer_id,
    emails: contactEmails(db, p.customer_id)
  }
}

/** Render to PDF and keep a copy in the data folder's pdfs/ directory. */
export async function writeDocumentPdf(db: Database.Database, userData: string, kind: DocumentKind, id: number, today: string): Promise<{ buffer: Buffer; file: string; built: BuiltDocument }> {
  const built = buildDocument(db, kind, id, today)
  const buffer = await renderPdf(built.doc)
  const dir = path.join(userData, 'pdfs')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, built.fileName)
  fs.writeFileSync(file, buffer)
  return { buffer, file, built }
}
