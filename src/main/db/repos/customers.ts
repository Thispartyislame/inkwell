import type Database from 'better-sqlite3'
import type { CustomerDetail, CustomerFilter } from '@shared/ipc'
import {
  ContactSchema,
  CustomerSchema,
  customerDisplayName,
  type Contact,
  type ContactInput,
  type Customer,
  type CustomerInput,
  type CustomerListRow
} from '@shared/schemas'
import { NotFoundError, parseOrThrow } from '../errors'
import { fromRow, insert, likePattern, now, toRow, update } from '../rows'
import { listActivity, logActivity } from './activity'
import { findAttachment } from './attachments'
import { customerQuoteStats, listQuotes } from './quotes'

const SPEC = { bool: ['shipping_same_as_billing', 'tax_exempt'], json: ['tags'] } as const

export function getCustomer(db: Database.Database, id: number): Customer {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) throw new NotFoundError('Customer', id)
  return fromRow<Customer>(row, SPEC)
}

export function listCustomers(db: Database.Database, f: CustomerFilter = {}): CustomerListRow[] {
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (!f.includeArchived) where.push('archived_at IS NULL')
  if (f.taxExempt !== undefined) {
    where.push('tax_exempt = @te')
    params.te = f.taxExempt ? 1 : 0
  }
  if (f.tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(customers.tags) WHERE value = @tag)')
    params.tag = f.tag
  }
  const q = f.search?.trim()
  if (q) {
    params.q = likePattern(q)
    where.push(`(company_name LIKE @q ESCAPE '\\' OR first_name LIKE @q ESCAPE '\\' OR last_name LIKE @q ESCAPE '\\'
      OR (first_name || ' ' || last_name) LIKE @q ESCAPE '\\' OR email LIKE @q ESCAPE '\\' OR phone LIKE @q ESCAPE '\\'
      OR tags LIKE @q ESCAPE '\\')`)
  }
  const rows = db
    .prepare(`SELECT * FROM customers ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(NULLIF(company_name, ''), first_name || ' ' || last_name) COLLATE NOCASE`)
    .all(params) as Record<string, unknown>[]
  return rows.map((r) => {
    const c = fromRow<Customer>(r, SPEC)
    return { ...c, display_name: customerDisplayName(c), ...customerStats(db, c.id) }
  })
}

/** Quote/invoice counts and balance. Invoices (and so balances) arrive in Phase 3. */
export function customerStats(db: Database.Database, customerId: number): Pick<CustomerListRow, 'quote_count' | 'invoice_count' | 'balance_cents'> {
  return { quote_count: customerQuoteStats(db, customerId).count, invoice_count: 0, balance_cents: 0 }
}

export function getCustomerDetail(db: Database.Database, id: number): CustomerDetail {
  const customer = getCustomer(db, id)
  return {
    customer,
    contacts: listContacts(db, id),
    certAttachment: findAttachment(db, customer.exempt_cert_attachment_id),
    quotes: listQuotes(db, { customer_id: id }).map((q) => ({ id: q.id, number: q.number, job_name: q.job_name, status: q.status, total_cents: q.total_cents, issued_on: q.issued_on })),
    invoices: [],
    balance_cents: customerStats(db, id).balance_cents,
    activity: listActivity(db, 'customer', id)
  }
}

export function saveCustomer(db: Database.Database, input: CustomerInput): Customer {
  const c = parseOrThrow(CustomerSchema, input)
  const tags = [...new Set(c.tags.map((t) => t.trim()).filter(Boolean))]
  const values = toRow({ ...c, tags }, SPEC)
  return db.transaction(() => {
    if (c.id) {
      const before = getCustomer(db, c.id)
      update(db, 'customers', c.id, values)
      const beforeRow = toRow(before as unknown as Record<string, unknown>, SPEC)
      const changed = Object.keys(values).filter((k) => k !== 'id' && beforeRow[k] !== values[k])
      if (changed.length) logActivity(db, 'customer', c.id, 'edited', { fields: changed })
      return getCustomer(db, c.id)
    }
    const id = insert(db, 'customers', values)
    logActivity(db, 'customer', id, 'created')
    return getCustomer(db, id)
  })()
}

export function setCustomerArchived(db: Database.Database, id: number, archived: boolean): Customer {
  return db.transaction(() => {
    getCustomer(db, id)
    db.prepare('UPDATE customers SET archived_at = ?, updated_at = ? WHERE id = ?').run(archived ? now() : null, now(), id)
    logActivity(db, 'customer', id, archived ? 'archived' : 'restored')
    return getCustomer(db, id)
  })()
}

export function listTags(db: Database.Database): string[] {
  return (
    db.prepare(`SELECT DISTINCT j.value AS t FROM customers, json_each(customers.tags) j WHERE customers.archived_at IS NULL ORDER BY t COLLATE NOCASE`).all() as {
      t: string
    }[]
  ).map((r) => r.t)
}

export function setCustomerCert(db: Database.Database, customerId: number, attachmentId: number | null): Customer {
  db.prepare('UPDATE customers SET exempt_cert_attachment_id = ?, updated_at = ? WHERE id = ?').run(attachmentId, now(), customerId)
  logActivity(db, 'customer', customerId, attachmentId ? 'certificate attached' : 'certificate removed')
  return getCustomer(db, customerId)
}

export function listContacts(db: Database.Database, customerId: number): Contact[] {
  return db.prepare('SELECT * FROM customer_contacts WHERE customer_id = ? ORDER BY sort_order, id').all(customerId) as Contact[]
}

export function saveContact(db: Database.Database, input: ContactInput): Contact {
  const c = parseOrThrow(ContactSchema, input)
  return db.transaction(() => {
    getCustomer(db, c.customer_id)
    let id = c.id
    if (id) {
      const existing = db.prepare('SELECT customer_id FROM customer_contacts WHERE id = ?').get(id) as { customer_id: number } | undefined
      if (!existing || existing.customer_id !== c.customer_id) throw new NotFoundError('Contact', id)
      update(db, 'customer_contacts', id, c)
    } else {
      const next = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM customer_contacts WHERE customer_id = ?').get(c.customer_id) as { n: number }).n
      id = insert(db, 'customer_contacts', { ...c, sort_order: next })
      logActivity(db, 'customer', c.customer_id, 'contact added', { name: c.name })
    }
    return db.prepare('SELECT * FROM customer_contacts WHERE id = ?').get(id) as Contact
  })()
}

export function deleteContact(db: Database.Database, id: number): void {
  db.transaction(() => {
    const row = db.prepare('SELECT customer_id, name FROM customer_contacts WHERE id = ?').get(id) as { customer_id: number; name: string } | undefined
    if (!row) throw new NotFoundError('Contact', id)
    db.prepare('DELETE FROM customer_contacts WHERE id = ?').run(id)
    logActivity(db, 'customer', row.customer_id, 'contact removed', { name: row.name })
  })()
}
