/**
 * Customer-facing documents (quote now; invoice, receipt and garment order later). Built from
 * the quote and settings into plain display strings, so the PDF template can only ever show what
 * is put here: no costs, markup, margin or internal notes.
 */
import { formatDate } from './dates'
import { bpToPercentString, formatMoney } from './money'
import { imprintSummary } from './pricing/engine'
import type { QuoteBreakdown } from './pricing/types'
import { garmentTitle, sizeBreakdown, toImprintInput, type QuoteCustomerSummary, type QuoteRecord } from './quote'
import type { Settings } from './schemas'
import { PAYMENT_METHOD_LABELS, type InvoiceRecord, type Payment } from './invoice'
import { SIZE_GROUP_LABELS } from './sizes'

export interface DocLine {
  title: string
  color: string
  description: string
  sizes: string
  imprints: string[]
  /** "$9.00" or ["S–XL $9.00", "2XL $11.00"] */
  unit_prices: string[]
  qty: number
  total: string
}

export interface DocAmount {
  label: string
  amount: string
  strong?: boolean
  muted?: boolean
}

export interface DocImage {
  url: string
  caption: string
}

export interface CustomerDocument {
  type: 'quote' | 'invoice' | 'receipt' | 'garment_order'
  title: string
  number: string
  accent: string
  shop: { name: string; logo_url: string; lines: string[] }
  meta: { label: string; value: string }[]
  bill_to: string[]
  ship_to: string[]
  job_name: string
  lines: DocLine[]
  fees: { name: string; detail: string; amount: string }[]
  totals: DocAmount[]
  callout: { label: string; amount: string } | null
  notes: string
  images: DocImage[]
  /** how to pay (invoices with a balance) */
  how_to_pay: string
  /** receipts: a short statement instead of line items */
  receipt: { heading: string; rows: { label: string; value: string }[] } | null
  /** garment order: one table per supplier */
  order?: { size_columns: string[]; groups: { supplier: string; rows: { style: string; color: string; sizes: string[]; total: string; cost: string }[]; total: string; cost: string }[]; show_cost: boolean; jobs: string[] }
  terms: string
  footer: string
  signature: boolean
  /** shown diagonally when the document is not a live offer */
  stamp: string
}

function shopLines(s: Settings): string[] {
  const cityLine = [s.city, [s.state, s.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [s.address_line1, s.address_line2, cityLine, [s.phone, s.email].filter(Boolean).join(' · '), s.website].filter(Boolean)
}

function party(c: QuoteCustomerSummary | null, address: string[]): string[] {
  if (!c) return []
  const person = [c.first_name, c.last_name].filter(Boolean).join(' ')
  return [c.company_name || person, c.company_name ? person : '', ...address, c.email, c.phone].filter(Boolean)
}

export interface QuoteDocInput {
  quote: QuoteRecord
  customer: QuoteCustomerSummary | null
  breakdown: QuoteBreakdown
  settings: Settings
  logo_url: string
  images: DocImage[]
  /** matrix column labels for DTF/transfer imprints, by imprint uid */
  column_labels?: Record<string, string>
  /** deposits received on the quote */
  payments?: Payment[]
}

/** Line items, fees and totals shared by quotes and invoices. */
function pricedBody(
  doc: { lines: QuoteRecord['lines']; discount_mode: QuoteRecord['discount_mode']; discount_value: number },
  b: QuoteBreakdown,
  customer: QuoteCustomerSummary | null,
  money: (c: number) => string,
  column_labels: Record<string, string>
): Pick<CustomerDocument, 'lines' | 'fees' | 'totals'> {
  const lines: DocLine[] = doc.lines
    .map((l, i) => ({ l, lb: b.lines[i] }))
    .filter(({ lb }) => lb && lb.qty > 0)
    .map(({ l, lb }) => {
      const groups = lb.groups
      const sameUnit = groups.every((g) => g.unit_cents === groups[0].unit_cents)
      return {
        title: garmentTitle(l) + (l.customer_supplied ? ' (customer-supplied)' : ''),
        color: l.color_name,
        description: l.garment.name || l.garment.brand ? l.description : '',
        sizes: sizeBreakdown(l.sizes),
        imprints: l.imprints.map((imp) => imprintSummary(toImprintInput(imp), column_labels[imp.uid])),
        unit_prices: sameUnit && groups.length ? [money(groups[0].unit_cents)] : groups.map((g) => `${SIZE_GROUP_LABELS[g.group]} ${money(g.unit_cents)}`),
        qty: lb.qty,
        total: money(lb.total_cents)
      }
    })

  const fees = b.fees
    .filter((f) => f.kind !== 'shipping' && f.kind !== 'rush')
    .map((f) => ({ name: f.name, detail: !f.auto && f.quantity !== 1 ? `${f.quantity} × ${money(f.unit_cents)}` : '', amount: money(f.amount_cents) }))

  const totals: DocAmount[] = [{ label: 'Subtotal', amount: money(b.subtotal_cents) }]
  if (b.discount_cents) totals.push({ label: doc.discount_mode === 'percent' ? `Discount (${bpToPercentString(doc.discount_value)}%)` : 'Discount', amount: `−${money(b.discount_cents)}` })
  if (b.rush_cents) totals.push({ label: b.fees.find((f) => f.kind === 'rush')?.name ?? 'Rush', amount: money(b.rush_cents) })
  if (b.tax_exempt_applied) totals.push({ label: `Sales tax (exempt${customer?.exempt_cert_number ? `, cert. ${customer.exempt_cert_number}` : ''})`, amount: money(0), muted: true })
  else if (b.tax_bp || b.tax_cents) totals.push({ label: `Sales tax (${bpToPercentString(b.tax_bp)}%)`, amount: money(b.tax_cents) })
  for (const f of b.fees.filter((x) => x.kind === 'shipping')) totals.push({ label: f.name, amount: money(f.amount_cents) })
  totals.push({ label: 'Total', amount: money(b.total_cents), strong: true })
  return { lines, fees, totals }
}

function header(s: Settings, logo_url: string) {
  return { accent: s.accent_color, shop: { name: s.shop_name, logo_url, lines: shopLines(s) }, footer: s.pdf_footer_text }
}

function parties(customer: QuoteCustomerSummary | null) {
  return {
    bill_to: party(customer, customer?.billing ?? []),
    ship_to: customer && customer.shipping.join('|') !== customer.billing.join('|') ? party(customer, customer.shipping) : []
  }
}

const paymentLabel = (p: Pick<Payment, 'received_on' | 'method' | 'check_number' | 'is_deposit'>) =>
  `${p.is_deposit ? 'Deposit' : 'Payment'} ${formatDate(p.received_on)} · ${PAYMENT_METHOD_LABELS[p.method]}${p.method === 'check' && p.check_number ? ` #${p.check_number}` : ''}`

export function quoteDocument({ quote: q, customer, breakdown: b, settings: s, logo_url, images, column_labels = {}, payments = [] }: QuoteDocInput): CustomerDocument {
  const money = (c: number) => formatMoney(c, s.currency)
  const body = pricedBody(q, b, customer, money, column_labels)
  const live = payments.filter((p) => !p.voided_at)
  for (const p of live) body.totals.push({ label: paymentLabel(p), amount: `−${money(p.amount_cents)}`, muted: true })
  if (live.length) body.totals.push({ label: 'Balance', amount: money(b.balance_cents), strong: true })

  const meta = [
    { label: 'Date', value: formatDate(q.issued_on) },
    { label: 'Valid until', value: formatDate(q.expires_on) },
    { label: 'In-hands date', value: formatDate(q.in_hands_on) },
    { label: 'Pieces', value: String(b.total_pieces) }
  ].filter((m) => m.value)

  const stamp = q.status === 'approved' ? 'APPROVED' : q.status === 'declined' ? 'DECLINED' : q.status === 'expired' ? 'EXPIRED' : q.status === 'superseded' ? 'REVISED' : ''

  return {
    type: 'quote',
    title: 'Quote',
    number: q.number,
    ...header(s, logo_url),
    meta,
    ...parties(customer),
    job_name: q.job_name,
    ...body,
    callout: live.length ? null : b.deposit_cents > 0 ? { label: `Deposit to start (${bpToPercentString(q.deposit_bp)}%)`, amount: money(b.deposit_cents) } : null,
    notes: q.customer_notes,
    images,
    how_to_pay: '',
    receipt: null,
    terms: s.terms_text,
    signature: q.status !== 'approved',
    stamp
  }
}

export interface InvoiceDocInput {
  invoice: InvoiceRecord
  customer: QuoteCustomerSummary | null
  breakdown: QuoteBreakdown
  settings: Settings
  logo_url: string
  images: DocImage[]
  payments: Payment[]
  source_quote_number: string | null
  column_labels?: Record<string, string>
}

export function invoiceDocument({ invoice: inv, customer, breakdown: b, settings: s, logo_url, images, payments, source_quote_number, column_labels = {} }: InvoiceDocInput): CustomerDocument {
  const money = (c: number) => formatMoney(c, s.currency)
  const body = pricedBody(inv, b, customer, money, column_labels)
  const live = payments.filter((p) => !p.voided_at)
  for (const p of live) body.totals.push({ label: paymentLabel(p), amount: `−${money(p.amount_cents)}`, muted: true })
  const balance = inv.total_cents - live.reduce((t, p) => t + p.amount_cents, 0)
  if (live.length) body.totals.push({ label: balance < 0 ? 'Credit' : 'Balance due', amount: money(Math.abs(balance)), strong: true })

  const meta = [
    { label: 'Invoice date', value: formatDate(inv.issued_on) },
    { label: 'Due date', value: formatDate(inv.due_on) },
    { label: 'Terms', value: inv.payment_terms },
    { label: 'PO number', value: inv.po_number },
    { label: 'Quote', value: source_quote_number ?? '' },
    { label: 'In-hands date', value: formatDate(inv.in_hands_on) }
  ].filter((m) => m.value)

  const paid = inv.status !== 'void' && inv.total_cents > 0 && balance <= 0
  return {
    type: 'invoice',
    title: 'Invoice',
    number: inv.number,
    ...header(s, logo_url),
    meta,
    ...parties(customer),
    job_name: inv.job_name,
    ...body,
    callout: inv.status === 'void' ? null : paid ? { label: 'Paid in full', amount: money(inv.total_cents) } : { label: `Balance due${inv.due_on ? ` by ${formatDate(inv.due_on)}` : ''}`, amount: money(balance) },
    notes: inv.customer_notes,
    images,
    how_to_pay: paid || inv.status === 'void' ? '' : s.how_to_pay_text,
    receipt: null,
    terms: '',
    signature: false,
    stamp: inv.status === 'void' ? 'VOID' : paid ? 'PAID' : ''
  }
}

export interface ReceiptDocInput {
  payment: Payment
  customer: QuoteCustomerSummary | null
  settings: Settings
  logo_url: string
  /** the invoice (or quote, for a deposit) it was applied to */
  applied: { kind: 'invoice' | 'quote'; number: string; job_name: string; total_cents: number; paid_cents: number }
}

export function receiptDocument({ payment: p, customer, settings: s, logo_url, applied }: ReceiptDocInput): CustomerDocument {
  const money = (c: number) => formatMoney(c, s.currency)
  const balance = applied.total_cents - applied.paid_cents
  return {
    type: 'receipt',
    title: 'Receipt',
    number: p.receipt_number,
    ...header(s, logo_url),
    meta: [
      { label: 'Date received', value: formatDate(p.received_on) },
      { label: 'Method', value: PAYMENT_METHOD_LABELS[p.method] + (p.method === 'check' && p.check_number ? ` #${p.check_number}` : '') },
      { label: 'Reference', value: p.reference }
    ].filter((m) => m.value),
    bill_to: party(customer, customer?.billing ?? []),
    ship_to: [],
    job_name: applied.job_name,
    lines: [],
    fees: [],
    totals: [
      { label: `${applied.kind === 'invoice' ? 'Invoice' : 'Quote'} ${applied.number} total`, amount: money(applied.total_cents) },
      { label: 'Paid to date', amount: money(applied.paid_cents) },
      { label: balance < 0 ? 'Credit' : 'Balance remaining', amount: money(Math.abs(balance)), strong: true }
    ],
    callout: { label: 'Amount received', amount: money(p.amount_cents) },
    notes: p.note,
    images: [],
    how_to_pay: '',
    receipt: {
      heading: p.voided_at ? 'This payment was voided' : 'Thank you for your payment',
      rows: [
        { label: p.is_deposit ? 'Deposit for' : 'Payment for', value: `${applied.kind === 'invoice' ? 'Invoice' : 'Quote'} ${applied.number}${applied.job_name ? ` · ${applied.job_name}` : ''}` },
        { label: 'Amount received', value: money(p.amount_cents) }
      ]
    },
    terms: '',
    signature: false,
    stamp: p.voided_at ? 'VOID' : ''
  }
}

/** Blank-garment order to place with distributors (internal; may show your cost). */
export function garmentOrderDocument(order: import('./production').GarmentOrder, s: Settings, logo_url: string, today: string, showCost = true): CustomerDocument {
  const money = (c: number) => formatMoney(c, s.currency)
  return {
    type: 'garment_order',
    title: 'Garment order',
    number: formatDate(today),
    ...header(s, logo_url),
    footer: '',
    meta: [
      { label: 'Jobs', value: String(order.jobs.length) },
      { label: 'Pieces', value: String(order.total) },
      ...(showCost ? [{ label: 'Est. cost', value: money(order.est_cost_cents) }] : [])
    ],
    bill_to: [],
    ship_to: [],
    job_name: '',
    lines: [],
    fees: [],
    totals: [],
    callout: null,
    notes: order.skipped_customer_supplied ? `${order.skipped_customer_supplied} customer-supplied line${order.skipped_customer_supplied === 1 ? '' : 's'} not included.` : '',
    images: [],
    how_to_pay: '',
    receipt: null,
    order: {
      size_columns: order.size_columns,
      show_cost: showCost,
      jobs: order.jobs.map((j) => [j.number, j.customer, j.job_name].filter(Boolean).join(' · ')),
      groups: order.groups.map((g) => ({
        supplier: g.supplier,
        total: String(g.total),
        cost: money(g.est_cost_cents),
        rows: g.items.map((i) => ({
          style: [[i.brand, i.style_number].filter(Boolean).join(' '), i.name].filter(Boolean).join(' – '),
          color: i.color,
          sizes: order.size_columns.map((c) => (i.sizes[c] ? String(i.sizes[c]) : '')),
          total: String(i.total),
          cost: money(i.est_cost_cents)
        }))
      }))
    },
    terms: '',
    signature: false,
    stamp: ''
  }
}
