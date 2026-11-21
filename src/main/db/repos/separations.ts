import type Database from 'better-sqlite3'
import { fileUrl } from '@shared/files'
import { InvoiceEditSchema, isInvoiceEditable, type InvoiceEdit } from '@shared/invoice'
import { isEditable, QuoteEditSchema, type QuoteEdit } from '@shared/quote'
import type { ImprintTarget, SeparationJob, SeparationSave, SourceKind } from '@shared/separations/job'
import { NotFoundError, UserError } from '../errors'
import { fromRow, insert, now } from '../rows'
import { logActivity } from './activity'
import { findAttachment } from './attachments'
import { loadInvoice, saveInvoice } from './invoices'
import { loadQuote, saveQuote } from './quotes'

type DB = Database.Database
const SPEC = { bool: ['has_underbase'], json: ['settings', 'detected_colors'] } as const

function row(db: DB, id: number): Record<string, unknown> {
  const r = db.prepare('SELECT * FROM separation_jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!r) throw new NotFoundError('Separation', id)
  return r
}

function toJob(db: DB, r: Record<string, unknown>): SeparationJob {
  const j = fromRow<Record<string, unknown>>(r, SPEC)
  const owner = j.owner_type && j.owner_id ? (db.prepare(`SELECT number FROM ${j.owner_type === 'quote' ? 'quotes' : 'invoices'} WHERE id = ?`).get(j.owner_id) as { number: string } | undefined) : undefined
  const thumb = findAttachment(db, (j.thumbnail_attachment_id as number) ?? null)
  const settings = j.settings && Object.keys(j.settings as object).length ? j.settings : null
  return {
    id: j.id as number,
    name: j.name as string,
    source_attachment_id: (j.source_attachment_id as number) ?? null,
    source_rel_path: j.source_rel_path as string,
    source_name: j.source_name as string,
    source_kind: j.source_kind as SourceKind,
    owner_type: (j.owner_type as SeparationJob['owner_type']) ?? null,
    owner_id: (j.owner_id as number) ?? null,
    owner_number: owner?.number ?? null,
    imprint_uid: (j.imprint_uid as string) ?? null,
    settings: settings as SeparationJob['settings'],
    detected_colors: j.detected_colors as SeparationJob['detected_colors'],
    plate_count: j.plate_count as number,
    ink_count: j.ink_count as number,
    has_underbase: j.has_underbase as boolean,
    output_pdf_path: (j.output_pdf_path as string) ?? null,
    output_attachment_id: (j.output_attachment_id as number) ?? null,
    thumbnail_attachment_id: (j.thumbnail_attachment_id as number) ?? null,
    thumbnail_url: thumb ? fileUrl(thumb.rel_path) : '',
    created_at: j.created_at as string,
    updated_at: j.updated_at as string
  }
}

export const getSeparation = (db: DB, id: number) => toJob(db, row(db, id))

export function listSeparations(db: DB, owner?: { type: 'quote' | 'invoice'; id: number }): SeparationJob[] {
  const rows = owner
    ? (db.prepare('SELECT * FROM separation_jobs WHERE owner_type = ? AND owner_id = ? ORDER BY updated_at DESC').all(owner.type, owner.id) as Record<string, unknown>[])
    : (db.prepare('SELECT * FROM separation_jobs ORDER BY updated_at DESC').all() as Record<string, unknown>[])
  return rows.map((r) => toJob(db, r))
}

export function createSeparation(
  db: DB,
  src: { rel_path: string; name: string; kind: SourceKind; attachment_id: number | null; owner: { type: 'quote' | 'invoice'; id: number } | null }
): SeparationJob {
  const id = insert(db, 'separation_jobs', {
    name: src.name.replace(/\.[a-z0-9]+$/i, ''),
    source_attachment_id: src.attachment_id,
    source_rel_path: src.rel_path,
    source_name: src.name,
    source_kind: src.kind,
    owner_type: src.owner?.type ?? null,
    owner_id: src.owner?.id ?? null
  })
  if (src.owner) logActivity(db, src.owner.type, src.owner.id, 'separation started', { file: src.name })
  return getSeparation(db, id)
}

export function saveSeparation(db: DB, id: number, s: SeparationSave): SeparationJob {
  row(db, id)
  const st = s.settings
  db.prepare(
    `UPDATE separation_jobs SET name = @name, settings = @settings, detected_colors = @detected, color_mapping = @mapping, ink_order = @order, underbase = @underbase,
       trap = @trap, halftone = @halftone, film_options = @film, plate_count = @plates, ink_count = @inks, has_underbase = @ub, updated_at = @now WHERE id = @id`
  ).run({
    id,
    name: s.name.trim().slice(0, 200),
    settings: JSON.stringify(st),
    detected: JSON.stringify(s.detected_colors),
    mapping: JSON.stringify({ merge: st.merge, dropped: st.dropped, inks: st.inks, overprint: st.overprint }),
    order: JSON.stringify(st.order),
    underbase: JSON.stringify(st.underbase),
    trap: JSON.stringify({ spread_pt: st.trap_pt }),
    halftone: JSON.stringify(st.halftone),
    film: JSON.stringify(st.film),
    plates: s.plate_count,
    inks: s.ink_count,
    ub: s.has_underbase ? 1 : 0,
    now: now()
  })
  return getSeparation(db, id)
}

export function setSeparationOutput(db: DB, id: number, out: { pdf_path: string | null; attachment_id: number | null; thumbnail_id: number | null }): SeparationJob {
  db.prepare('UPDATE separation_jobs SET output_pdf_path = COALESCE(?, output_pdf_path), output_attachment_id = COALESCE(?, output_attachment_id), thumbnail_attachment_id = COALESCE(?, thumbnail_attachment_id), updated_at = ? WHERE id = ?').run(
    out.pdf_path,
    out.attachment_id,
    out.thumbnail_id,
    now(),
    id
  )
  return getSeparation(db, id)
}

export function deleteSeparation(db: DB, id: number): { files: string[] } {
  const j = getSeparation(db, id)
  const files: string[] = []
  db.transaction(() => {
    db.prepare('UPDATE quote_imprints SET separation_job_id = NULL WHERE separation_job_id = ?').run(id)
    db.prepare('UPDATE invoice_imprints SET separation_job_id = NULL WHERE separation_job_id = ?').run(id)
    // The job's own copy of the art (when imported directly, not from an attachment) goes too.
    if (!j.source_attachment_id) files.push(j.source_rel_path)
    db.prepare('DELETE FROM separation_jobs WHERE id = ?').run(id)
  })()
  return { files }
}

/**
 * Link a job to an imprint: the imprint's color count and underbase come from the separation
 * (screen fees follow), marked with a "from separations" badge. Only editable documents.
 */
export function linkSeparation(db: DB, id: number, t: ImprintTarget, today: string): SeparationJob {
  const job = getSeparation(db, id)
  if (!job.plate_count) throw new UserError('Make the separations first, then link them to an imprint')
  const apply = <E extends QuoteEdit | InvoiceEdit>(e: E): E => {
    let found = false
    const lines = e.lines.map((l) => ({
      ...l,
      imprints: l.imprints.map((i) => {
        if (i.uid !== t.imprint_uid) return i
        found = true
        return { ...i, method: 'screen' as const, colors: job.ink_count, underbase: job.has_underbase, underbase_source: 'manual' as const, separation_job_id: id }
      })
    }))
    if (!found) throw new UserError('That imprint is no longer on the document')
    return { ...e, lines }
  }
  db.transaction(() => {
    if (t.kind === 'quote') {
      const q = loadQuote(db, t.id)
      if (!isEditable(q)) throw new UserError(`${q.number} is ${q.status}; revise it to link separations`)
      const e = Object.fromEntries(Object.keys(QuoteEditSchema.shape).map((k) => [k, q[k as keyof QuoteEdit]])) as QuoteEdit
      saveQuote(db, apply(e), today)
    } else {
      const inv = loadInvoice(db, t.id)
      if (!isInvoiceEditable(inv)) throw new UserError(`${inv.number} has been sent and can’t be changed`)
      const e = Object.fromEntries(Object.keys(InvoiceEditSchema.shape).map((k) => [k, inv[k as keyof InvoiceEdit]])) as InvoiceEdit
      saveInvoice(db, apply(e), today)
    }
    db.prepare('UPDATE separation_jobs SET owner_type = ?, owner_id = ?, imprint_uid = ?, updated_at = ? WHERE id = ?').run(t.kind, t.id, t.imprint_uid, now(), id)
    logActivity(db, t.kind, t.id, 'separations linked', { job: job.name, screens: job.ink_count + (job.has_underbase ? 1 : 0) })
  })()
  return getSeparation(db, id)
}
