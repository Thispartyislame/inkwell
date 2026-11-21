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
  type: 'quote'
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
}

export function quoteDocument({ quote: q, customer, breakdown: b, settings: s, logo_url, images, column_labels = {} }: QuoteDocInput): CustomerDocument {
  const money = (c: number) => formatMoney(c, s.currency)
  const lines: DocLine[] = q.lines
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
  if (b.discount_cents) totals.push({ label: q.discount_mode === 'percent' ? `Discount (${bpToPercentString(q.discount_value)}%)` : 'Discount', amount: `−${money(b.discount_cents)}` })
  if (b.rush_cents) totals.push({ label: b.fees.find((f) => f.kind === 'rush')?.name ?? 'Rush', amount: money(b.rush_cents) })
  if (b.tax_exempt_applied) totals.push({ label: `Sales tax (exempt${customer?.exempt_cert_number ? `, cert. ${customer.exempt_cert_number}` : ''})`, amount: money(0), muted: true })
  else if (b.tax_bp || b.tax_cents) totals.push({ label: `Sales tax (${bpToPercentString(b.tax_bp)}%)`, amount: money(b.tax_cents) })
  for (const f of b.fees.filter((x) => x.kind === 'shipping')) totals.push({ label: f.name, amount: money(f.amount_cents) })
  totals.push({ label: 'Total', amount: money(b.total_cents), strong: true })

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
    accent: s.accent_color,
    shop: { name: s.shop_name, logo_url, lines: shopLines(s) },
    meta,
    bill_to: party(customer, customer?.billing ?? []),
    ship_to: customer && customer.shipping.join('|') !== customer.billing.join('|') ? party(customer, customer.shipping) : [],
    job_name: q.job_name,
    lines,
    fees,
    totals,
    callout: b.deposit_cents > 0 ? { label: `Deposit to start (${bpToPercentString(q.deposit_bp)}%)`, amount: money(b.deposit_cents) } : null,
    notes: q.customer_notes,
    images,
    terms: s.terms_text,
    footer: s.pdf_footer_text,
    signature: q.status !== 'approved',
    stamp
  }
}
