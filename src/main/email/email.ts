import type Database from 'better-sqlite3'
import { clipboard, safeStorage, shell } from 'electron'
import nodemailer from 'nodemailer'
import { mergeTemplate, parseEmailList } from '@shared/merge-fields'
import type { EmailCompose, EmailSendInput } from '@shared/ipc'
import { UserError } from '../db/errors'
import { logActivity } from '../db/repos/activity'
import { markInvoiceSent } from '../db/repos/invoices'
import { getPayment } from '../db/repos/payments'
import { loadQuote, markSent } from '../db/repos/quotes'
import { getSettings, getSmtpPasswordEnc } from '../db/repos/settings'
import { buildDocument, writeDocumentPdf, type DocumentKind } from '../documents'

type DB = Database.Database

async function smtpPassword(db: DB): Promise<string | null> {
  const enc = getSmtpPasswordEnc(db)
  if (!enc) return null
  try {
    return (await safeStorage.decryptStringAsync(Buffer.from(enc))).result
  } catch {
    try {
      // saved by an earlier version with the synchronous API
      return safeStorage.decryptString(Buffer.from(enc))
    } catch {
      return null
    }
  }
}

export function smtpReady(db: DB): boolean {
  const s = getSettings(db)
  return !!(s.smtp_host.trim() && s.smtp_user.trim() && s.smtp_password_set)
}

async function transport(db: DB) {
  const s = getSettings(db)
  const pass = await smtpPassword(db)
  if (!s.smtp_host.trim() || !s.smtp_user.trim() || !pass) throw new UserError('Email isn’t set up. Add your SMTP server, username and password in Settings → Email.')
  return {
    t: nodemailer.createTransport({ host: s.smtp_host.trim(), port: s.smtp_port, secure: s.smtp_secure, auth: { user: s.smtp_user.trim(), pass }, connectionTimeout: 20_000 }),
    from: { name: s.smtp_from_name.trim() || s.shop_name, address: s.smtp_user.includes('@') ? s.smtp_user.trim() : s.email },
    replyTo: s.email || undefined
  }
}

const TEMPLATE_KEYS: Record<DocumentKind, ['email_quote_subject' | 'email_invoice_subject' | 'email_receipt_subject', 'email_quote_body' | 'email_invoice_body' | 'email_receipt_body']> = {
  quote: ['email_quote_subject', 'email_quote_body'],
  invoice: ['email_invoice_subject', 'email_invoice_body'],
  receipt: ['email_receipt_subject', 'email_receipt_body']
}

export function compose(db: DB, kind: DocumentKind, id: number, today: string): EmailCompose {
  const s = getSettings(db)
  const built = buildDocument(db, kind, id, today)
  const [subjectKey, bodyKey] = TEMPLATE_KEYS[kind]
  return {
    to: built.emails[0] ?? '',
    suggestions: built.emails,
    subject: mergeTemplate(s[subjectKey], built.merge),
    body: mergeTemplate(s[bodyKey], built.merge),
    attachment_name: built.fileName,
    smtp_ready: smtpReady(db)
  }
}

/** After a document goes out: quotes and invoices in draft become Sent. */
function afterSend(db: DB, kind: DocumentKind, id: number, today: string, markAsSent: boolean, how: string, to?: string) {
  if (kind === 'receipt') {
    const p = getPayment(db, id)
    if (p.invoice_id) logActivity(db, 'invoice', p.invoice_id, how, { receipt: p.receipt_number, ...(to ? { to } : {}) })
    else if (p.quote_id) logActivity(db, 'quote', p.quote_id, how, { receipt: p.receipt_number, ...(to ? { to } : {}) })
    return
  }
  logActivity(db, kind, id, how, to ? { to } : {})
  if (!markAsSent) return
  if (kind === 'quote' && loadQuote(db, id).status === 'draft') markSent(db, id, today)
  if (kind === 'invoice') markInvoiceSent(db, id, today)
}

export async function sendDocument(db: DB, userData: string, input: EmailSendInput, today: string): Promise<{ to: string[] }> {
  const to = parseEmailList(input.to)
  const cc = parseEmailList(input.cc ?? '')
  if (to.invalid.length || cc.invalid.length) throw new UserError(`Not a valid email address: ${[...to.invalid, ...cc.invalid].join(', ')}`)
  if (!to.valid.length) throw new UserError('Enter at least one recipient')
  if (!input.subject.trim()) throw new UserError('Enter a subject')
  // Check sendability before rendering (e.g. a quote with no customer)
  if (input.kind === 'quote' && input.mark_sent && loadQuote(db, input.id).status === 'draft' && !loadQuote(db, input.id).customer_id) throw new UserError('Pick a customer first')
  const { t, from, replyTo } = await transport(db)
  const { buffer, built } = await writeDocumentPdf(db, userData, input.kind, input.id, today)
  try {
    await t.sendMail({ from, replyTo, to: to.valid, cc: cc.valid.length ? cc.valid : undefined, subject: input.subject.trim(), text: input.body, attachments: [{ filename: built.fileName, content: buffer, contentType: 'application/pdf' }] })
  } catch (e) {
    throw new UserError(`The email wasn’t sent: ${(e as Error).message}`)
  }
  try {
    afterSend(db, input.kind, input.id, today, input.mark_sent, 'emailed', to.valid.join(', '))
  } catch (e) {
    // The email went out; don't report failure because marking it sent didn't work.
    console.error('[email] sent, but could not update status', e)
  }
  return { to: to.valid }
}

/** No SMTP: save the PDF, show it in its folder and put the message on the clipboard. */
export async function prepareManualEmail(db: DB, userData: string, input: Omit<EmailSendInput, 'to' | 'cc'> & { to?: string }, today: string): Promise<{ file: string }> {
  const { file } = await writeDocumentPdf(db, userData, input.kind, input.id, today)
  clipboard.writeText(`${input.to ? `To: ${input.to}\n` : ''}Subject: ${input.subject}\n\n${input.body}`)
  shell.showItemInFolder(file)
  afterSend(db, input.kind, input.id, today, input.mark_sent, 'PDF saved for email')
  return { file }
}

export async function sendTestEmail(db: DB, to: string): Promise<void> {
  const list = parseEmailList(to)
  if (!list.valid.length || list.invalid.length) throw new UserError('Enter one valid email address')
  const { t, from, replyTo } = await transport(db)
  try {
    await t.verify()
    await t.sendMail({ from, replyTo, to: list.valid, subject: 'Inkwell test email', text: 'Your email settings work. Quotes, invoices and receipts can now be emailed from Inkwell.' })
  } catch (e) {
    throw new UserError(`Couldn’t send: ${(e as Error).message}`)
  }
}
