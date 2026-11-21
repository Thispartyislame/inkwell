import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../../src/main/db/migrate'
import { seedIfEmpty } from '../../src/main/db/seed'
import { saveCustomer } from '../../src/main/db/repos/customers'
import { createQuote, getQuoteDetail, loadQuote, markSent, saveQuote } from '../../src/main/db/repos/quotes'
import { createSeparation, deleteSeparation, getSeparation, linkSeparation, listSeparations, saveSeparation } from '../../src/main/db/repos/separations'
import { newImprint, newLine, QuoteEditSchema, type QuoteEdit } from '../../src/shared/quote'
import { DEFAULT_FILM, type SeparationSettings } from '../../src/shared/separations/types'

const TODAY = '2026-11-21'
let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  seedIfEmpty(db)
})

const settings: SeparationSettings = {
  art_width_pt: 720,
  garment_hex: '#111111',
  merge: {},
  dropped: [],
  inks: {},
  order: ['#ffffff', '#ff0000', '#000000'],
  overprint: [],
  trap_pt: 0,
  underbase: { enabled: true, choke_pt: 0.75, exclude: [], highlight_white: false },
  halftone: { lpi: 50, angle: 22.5, shape: 'round' },
  film: DEFAULT_FILM,
  label: { job: '', number: '', location: '' }
}

function quoteWithImprint() {
  const c = saveCustomer(db, { company_name: 'Riverside', first_name: '', last_name: '', email: '', phone: '', billing_line1: '', billing_line2: '', billing_city: '', billing_state: '', billing_postal_code: '', shipping_same_as_billing: true, shipping_line1: '', shipping_line2: '', shipping_city: '', shipping_state: '', shipping_postal_code: '', tax_exempt: false, exempt_cert_number: '', exempt_cert_attachment_id: null, exempt_cert_expires_on: null, pricing_matrix_id: null, notes: '', tags: [] })
  const q = createQuote(db, { customer_id: c.id }, TODAY)
  const imp = newImprint({ colors: 1 })
  const e = Object.fromEntries(Object.keys(QuoteEditSchema.shape).map((k) => [k, q[k as keyof QuoteEdit]])) as QuoteEdit
  saveQuote(db, { ...e, lines: [newLine({ sizes: [{ size: 'M', qty: 24 }], costs: { base: 250, '2xl': 0, '3xl': 0, '4xl_plus': 0 }, imprints: [imp] })] }, TODAY)
  return { q: loadQuote(db, q.id), uid: imp.uid }
}

describe('separation jobs', () => {
  it('saves settings and results', () => {
    const j = createSeparation(db, { rel_path: 'attachments/separations/x.svg', name: 'logo.svg', kind: 'svg', attachment_id: null, owner: null })
    expect(j).toMatchObject({ name: 'logo', source_kind: 'svg', plate_count: 0, settings: null })
    const s = saveSeparation(db, j.id, { name: 'Brewery logo', settings, detected_colors: [], plate_count: 4, ink_count: 3, has_underbase: true })
    expect(s).toMatchObject({ name: 'Brewery logo', plate_count: 4, ink_count: 3, has_underbase: true })
    expect(s.settings?.order).toEqual(['#ffffff', '#ff0000', '#000000'])
    expect(listSeparations(db)).toHaveLength(1)
  })

  it('linking fills in the imprint’s colors and underbase, and screens follow', () => {
    const { q, uid } = quoteWithImprint()
    const j = createSeparation(db, { rel_path: 'a.svg', name: 'a.svg', kind: 'svg', attachment_id: null, owner: null })
    expect(() => linkSeparation(db, j.id, { kind: 'quote', id: q.id, imprint_uid: uid }, TODAY)).toThrow(/first/)
    saveSeparation(db, j.id, { name: 'a', settings, detected_colors: [], plate_count: 4, ink_count: 3, has_underbase: true })
    const linked = linkSeparation(db, j.id, { kind: 'quote', id: q.id, imprint_uid: uid }, TODAY)
    expect(linked).toMatchObject({ owner_type: 'quote', owner_id: q.id, owner_number: 'Q-1001', imprint_uid: uid })
    const imp = loadQuote(db, q.id).lines[0].imprints[0]
    expect(imp).toMatchObject({ colors: 3, underbase: true, separation_job_id: j.id, method: 'screen' })
    expect(getQuoteDetail(db, q.id, TODAY).breakdown.screens).toBe(4)
    expect(listSeparations(db, { type: 'quote', id: q.id })).toHaveLength(1)

    // a sent quote can't be changed
    markSent(db, q.id, TODAY)
    expect(() => linkSeparation(db, j.id, { kind: 'quote', id: q.id, imprint_uid: uid }, TODAY)).toThrow(/revise/)
  })

  it('deleting a job unlinks imprints and returns its own file for cleanup', () => {
    const { q, uid } = quoteWithImprint()
    const j = createSeparation(db, { rel_path: 'attachments/separations/own.svg', name: 'own.svg', kind: 'svg', attachment_id: null, owner: null })
    saveSeparation(db, j.id, { name: 'own', settings, detected_colors: [], plate_count: 2, ink_count: 2, has_underbase: false })
    linkSeparation(db, j.id, { kind: 'quote', id: q.id, imprint_uid: uid }, TODAY)
    expect(deleteSeparation(db, j.id).files).toEqual(['attachments/separations/own.svg'])
    expect(loadQuote(db, q.id).lines[0].imprints[0].separation_job_id).toBeNull()
    expect(() => getSeparation(db, j.id)).toThrow(/not found/)
  })
})
