/**
 * The quote pricing engine. Pure: same input → same output, no I/O. Used live by the quote
 * builder and by the main process when saving, so the screen, the database and the PDF agree.
 * All amounts are integer cents; all rates are basis points.
 */
import { applyBp, BP_PER_UNIT, divRound, roundToStep, type Cents } from '../money'
import { METHOD_LABELS, SPECIALTY_LABELS } from '../schemas'
import { SIZE_GROUP_LABELS, SIZE_GROUPS, sizeGroup, type SizeGroup } from '../sizes'
import { garmentPrice, marginBp } from './garment'
import type {
  AutoFeeKey,
  FeeLine,
  GroupBreakdown,
  ImprintBreakdown,
  ImprintInput,
  LineBreakdown,
  LineInput,
  MatrixForPricing,
  PricingContext,
  PricingWarning,
  QuoteBreakdown,
  QuotePricingInput
} from './types'
import { LOCATION_LABELS } from './types'

const STEP: Record<PricingContext['rounding_mode'], number> = { cent: 1, nickel: 5, quarter: 25 }

/** Everything about an imprint that affects price or screens; identical keys = same design. */
function imprintSignature(i: ImprintInput): string {
  return JSON.stringify([
    i.location,
    i.location === 'custom' ? i.location_custom.trim().toLowerCase() : '',
    i.method,
    i.method === 'screen' ? i.colors : 0,
    i.method === 'screen' && i.underbase,
    [...i.specialty].sort(),
    i.print_size,
    i.method === 'embroidery' ? i.stitch_count : 0,
    i.method === 'dtf' || i.method === 'transfer' ? i.transfer_size : 0,
    i.matrix_id
  ])
}

/** Lines with the same design key carry the same set of imprints (the same print job). */
export function designKey(imprints: ImprintInput[]): string {
  return imprints.map(imprintSignature).sort().join('|')
}

export function pickMatrix(imp: ImprintInput, ctx: PricingContext): MatrixForPricing | null {
  const ofMethod = ctx.matrices.filter((m) => m.method === imp.method)
  if (imp.matrix_id != null) {
    const m = ctx.matrices.find((x) => x.id === imp.matrix_id)
    if (m) return m
  }
  const customer = ctx.customer?.pricing_matrix_id != null ? ofMethod.find((m) => m.id === ctx.customer!.pricing_matrix_id) : undefined
  return customer ?? ofMethod.find((m) => m.is_default) ?? ofMethod[0] ?? null
}

function columnLabel(m: MatrixForPricing, idx: number): string {
  const c = m.columns[idx]
  if (c.label) return c.label
  if (m.column_kind === 'colors') return `${c.value} color${c.value === 1 ? '' : 's'}`
  if (m.column_kind === 'stitches') return `≤ ${c.value.toLocaleString('en-US')} stitches`
  return `Size ${c.value}`
}

/** Price of one imprint per piece at a given quantity. */
export function priceImprint(imp: ImprintInput, qty: number, ctx: PricingContext, warn: (w: Omit<PricingWarning, 'imprint_uid'>) => void): ImprintBreakdown {
  const m = pickMatrix(imp, ctx)
  const adders: { label: string; cents: Cents }[] = []
  const r = ctx.rules
  const isScreen = imp.method === 'screen'
  if (isScreen && imp.underbase && r.underbase_mode === 'flat_adder') adders.push({ label: 'Underbase', cents: r.underbase_adder_cents })
  for (const s of imp.specialty) if (r.specialty_adders[s]) adders.push({ label: SPECIALTY_LABELS[s], cents: r.specialty_adders[s] })
  if (imp.print_size !== 'standard' && r.oversize_adders[imp.print_size]) adders.push({ label: imp.print_size === 'jumbo' ? 'Jumbo print' : 'Oversized print', cents: r.oversize_adders[imp.print_size] })
  const addersTotal = adders.reduce((t, a) => t + a.cents, 0)

  if (!m) {
    warn({ code: 'no_matrix', message: `No price matrix for ${METHOD_LABELS[imp.method]}. Add one under Pricing.`, severity: 'warn' })
    return { uid: imp.uid, matrix_id: null, matrix_name: '', break_qty: 0, priced_qty: qty, column_label: '', matrix_cents: 0, adders, per_piece_cents: addersTotal }
  }

  // Row: the largest break at or below the quantity.
  let row = -1
  for (let i = 0; i < m.breaks.length; i++) if (m.breaks[i] <= qty) row = i
  if (row === -1) {
    row = 0
    if (qty > 0) warn({ code: 'below_matrix_min', message: `${qty} pieces is below the smallest break (${m.breaks[0]}) of “${m.name}”; priced at ${m.breaks[0]}.`, severity: 'info' })
  }

  // Column: the value this imprint needs (colors incl. underbase, stitches, or size band).
  const target =
    m.column_kind === 'colors'
      ? Math.max(1, (isScreen ? imp.colors : imp.colors || 1) + (isScreen && imp.underbase && r.underbase_mode === 'plus_one_color' ? 1 : 0))
      : m.column_kind === 'stitches'
        ? Math.max(1, imp.stitch_count)
        : Math.max(1, imp.transfer_size)
  let col = m.columns.findIndex((c) => c.value >= target)
  let extra = 0
  if (col === -1) {
    col = m.columns.length - 1
    const last = m.columns[col].value
    if (m.above_max_rule === 'per_extra_color') {
      // Colors and size bands count whole steps; stitches count each extra 1,000.
      const units = m.column_kind === 'stitches' ? Math.ceil((target - last) / 1000) : target - last
      extra = units * m.above_max_adder_cents
      const what = m.column_kind === 'stitches' ? `${units} × 1,000 extra stitches` : m.column_kind === 'colors' ? `${units} extra color${units === 1 ? '' : 's'}` : `${units} size step${units === 1 ? '' : 's'} up`
      adders.unshift({ label: what, cents: extra })
    } else {
      warn({
        code: 'above_matrix_max',
        message:
          m.above_max_rule === 'not_allowed'
            ? `“${m.name}” doesn’t allow more than ${columnLabel(m, col)}; this imprint needs ${target}.`
            : `Needs ${target}, beyond the last column of “${m.name}”; priced at ${columnLabel(m, col)}.`,
        severity: m.above_max_rule === 'not_allowed' ? 'warn' : 'info'
      })
    }
  }
  const matrixCents = m.prices[row]?.[col] ?? 0
  return {
    uid: imp.uid,
    matrix_id: m.id,
    matrix_name: m.name,
    break_qty: m.breaks[row],
    priced_qty: qty,
    column_label: columnLabel(m, col) + (extra ? ` + ${target - m.columns[col].value}` : ''),
    matrix_cents: matrixCents,
    adders,
    per_piece_cents: matrixCents + addersTotal + extra
  }
}

function lineQty(l: LineInput): number {
  return l.sizes.reduce((t, s) => t + Math.max(0, s.qty | 0), 0)
}

export function priceQuote(input: QuotePricingInput, ctx: PricingContext): QuoteBreakdown {
  const warnings: PricingWarning[] = []
  const step = STEP[ctx.rounding_mode]
  const keys = input.lines.map((l) => designKey(l.imprints))
  const qtys = input.lines.map(lineQty)

  // Quantity used for breaks: the whole run of an identical design, when combining is on.
  const runQty = new Map<string, number>()
  input.lines.forEach((l, i) => {
    if (l.imprints.length) runQty.set(keys[i], (runQty.get(keys[i]) ?? 0) + qtys[i])
  })

  const lines: LineBreakdown[] = input.lines.map((l, i) => {
    const qty = qtys[i]
    const pricedQty = ctx.combine_quantities && l.imprints.length ? runQty.get(keys[i])! : qty
    const imprints = l.imprints.map((imp) =>
      priceImprint(imp, pricedQty, ctx, (w) => warnings.push({ ...w, line_uid: l.uid, imprint_uid: imp.uid }))
    )
    const decoration = imprints.reduce((t, x) => t + x.per_piece_cents, 0)
    if (qty === 0) warnings.push({ code: 'no_quantity', message: 'No quantities entered.', line_uid: l.uid, severity: 'info' })
    if (!l.imprints.length && qty > 0) warnings.push({ code: 'no_imprints', message: 'No imprints: priced as blank garments.', line_uid: l.uid, severity: 'info' })

    const byGroup = new Map<SizeGroup, number>()
    for (const s of l.sizes) if (s.qty > 0) byGroup.set(sizeGroup(s.size), (byGroup.get(sizeGroup(s.size)) ?? 0) + (s.qty | 0))
    const groups: GroupBreakdown[] = SIZE_GROUPS.filter((g) => byGroup.has(g)).map((g) => {
      const gq = byGroup.get(g)!
      const cost = l.customer_supplied ? 0 : l.costs[g]
      if (!l.customer_supplied && cost === 0)
        warnings.push({ code: 'no_garment_cost', message: `No garment cost for ${SIZE_GROUP_LABELS[g]}; garment priced at $0.`, line_uid: l.uid, severity: 'warn' })
      const garment = l.customer_supplied ? 0 : garmentPrice(cost, ctx.rules)
      const upcharge = l.customer_supplied || cost === 0 ? 0 : ctx.rules.size_upcharges[g]
      const calculated = roundToStep(garment + decoration + upcharge, step)
      const override = l.overrides[g]
      const overridden = override != null
      if (overridden) warnings.push({ code: 'unit_override', message: `${SIZE_GROUP_LABELS[g]} unit price set by hand.`, line_uid: l.uid, severity: 'info' })
      const unit = overridden ? override! : calculated
      return {
        group: g,
        qty: gq,
        cost_cents: cost,
        garment_cents: garment,
        decoration_cents: decoration,
        upcharge_cents: upcharge,
        calculated_unit_cents: calculated,
        unit_cents: unit,
        overridden,
        total_cents: unit * gq
      }
    })
    return {
      uid: l.uid,
      qty,
      design_key: keys[i],
      priced_qty: pricedQty,
      groups,
      imprints,
      decoration_per_piece_cents: decoration,
      total_cents: groups.reduce((t, g) => t + g.total_cents, 0),
      cost_cents: groups.reduce((t, g) => t + g.cost_cents * g.qty, 0)
    }
  })

  const totalPieces = qtys.reduce((a, b) => a + b, 0)
  const itemsSubtotal = lines.reduce((t, l) => t + l.total_cents, 0)
  const r = ctx.rules
  const disabled = new Set<AutoFeeKey>(input.disabled_auto_fees)

  // ---- automatic per-job fees ----
  const fees: FeeLine[] = []
  // Screens are burned once per design, not once per shirt color.
  let screens = 0
  let feeUnits = 0
  let reorderUnits = 0
  const seenDesigns = new Set<string>()
  input.lines.forEach((l, i) => {
    if (qtys[i] === 0 || seenDesigns.has(keys[i])) return
    seenDesigns.add(keys[i])
    for (const imp of l.imprints) {
      if (imp.method !== 'screen') continue
      const s = Math.max(0, imp.colors) + (imp.underbase ? 1 : 0)
      const units = r.screen_fee_basis === 'per_screen' ? s : Math.max(0, imp.colors)
      screens += s
      if (imp.is_reorder) reorderUnits += units
      else feeUnits += units
    }
  })
  if (screens > 0 && r.screen_fee_cents > 0 && !disabled.has('screens')) {
    const full = feeUnits * r.screen_fee_cents
    const reorderUnit = r.screen_fee_cents - applyBp(r.screen_fee_cents, r.reorder_screen_discount_bp)
    const reorder = reorderUnits * reorderUnit
    if (feeUnits + reorderUnits > 0) {
      const parts = [feeUnits ? `${feeUnits} × ${fmt(r.screen_fee_cents)}` : '', reorderUnits ? `${reorderUnits} reorder × ${fmt(reorderUnit)}` : ''].filter(Boolean)
      fees.push({
        key: 'auto:screens',
        name: r.screen_fee_basis === 'per_screen' ? `Screens / setup (${screens} screen${screens === 1 ? '' : 's'})` : `Setup (${feeUnits + reorderUnits} color${feeUnits + reorderUnits === 1 ? '' : 's'})`,
        auto: true,
        kind: 'screen',
        quantity: feeUnits + reorderUnits,
        unit_cents: r.screen_fee_cents,
        amount_cents: full + reorder,
        taxable: ctx.auto_fee_taxable.screens,
        detail: parts.join(' + ')
      })
    }
  }
  // Digitizing: once per new embroidery design.
  let digitize = 0
  const seenEmb = new Set<string>()
  input.lines.forEach((l, i) => {
    if (qtys[i] === 0) return
    for (const imp of l.imprints) {
      if (imp.method !== 'embroidery' || !imp.new_digitizing) continue
      const k = keys[i] + '#' + imprintSignature(imp)
      if (seenEmb.has(k)) continue
      seenEmb.add(k)
      digitize++
    }
  })
  if (digitize && r.digitizing_fee_cents > 0 && !disabled.has('digitizing'))
    fees.push({ key: 'auto:digitizing', name: `Digitizing (${digitize} design${digitize === 1 ? '' : 's'})`, auto: true, kind: 'digitizing', quantity: digitize, unit_cents: r.digitizing_fee_cents, amount_cents: digitize * r.digitizing_fee_cents, taxable: ctx.auto_fee_taxable.digitizing })
  if (totalPieces > 0 && totalPieces < r.min_order_qty) {
    warnings.push({ code: 'below_min_order', message: `${totalPieces} pieces is below your ${r.min_order_qty}-piece minimum.`, severity: 'info' })
    if (r.below_min_fee_cents > 0 && !disabled.has('below_min'))
      fees.push({ key: 'auto:below_min', name: `Small order fee (under ${r.min_order_qty} pieces)`, auto: true, kind: 'other', quantity: 1, unit_cents: r.below_min_fee_cents, amount_cents: r.below_min_fee_cents, taxable: ctx.auto_fee_taxable.below_min })
  }

  // ---- manual fees ----
  for (const f of input.fees) {
    const q = f.quantity ?? (f.basis === 'per_piece' ? totalPieces : 1)
    fees.push({ key: f.uid, name: f.name, auto: false, kind: f.kind, quantity: q, unit_cents: f.amount_cents, amount_cents: f.amount_cents * q, taxable: f.taxable })
  }

  // ---- totals: subtotal → discount → rush → tax → shipping ----
  const shippingFees = fees.filter((f) => f.kind === 'shipping')
  const otherFees = fees.filter((f) => f.kind !== 'shipping')
  const feesSubtotal = otherFees.reduce((t, f) => t + f.amount_cents, 0)
  const subtotal = itemsSubtotal + feesSubtotal
  const taxableSubtotal = itemsSubtotal + otherFees.filter((f) => f.taxable).reduce((t, f) => t + f.amount_cents, 0)

  const discount = Math.min(subtotal, input.discount_mode === 'percent' ? applyBp(subtotal, Math.min(input.discount_value, BP_PER_UNIT)) : Math.max(0, input.discount_value))
  const afterDiscount = subtotal - discount
  // The discount lowers the taxable amount in proportion.
  const taxableAfterDiscount = subtotal > 0 ? taxableSubtotal - divRound(discount * taxableSubtotal, subtotal) : 0

  let rush = 0
  if (input.rush && !disabled.has('rush')) {
    rush = r.rush_mode === 'percent' ? applyBp(afterDiscount, r.rush_value) : r.rush_value
    if (rush > 0) fees.push({ key: 'auto:rush', name: r.rush_mode === 'percent' ? `Rush (${pct(r.rush_value)})` : 'Rush', auto: true, kind: 'rush', quantity: 1, unit_cents: rush, amount_cents: rush, taxable: ctx.auto_fee_taxable.rush })
  }
  // Rush is taxable in proportion to the taxable share of the order.
  const rushTaxable = rush && ctx.auto_fee_taxable.rush && afterDiscount > 0 ? divRound(rush * taxableAfterDiscount, afterDiscount) : 0

  const shipping = shippingFees.reduce((t, f) => t + f.amount_cents, 0)
  const shippingTaxable = shippingFees.filter((f) => f.taxable).reduce((t, f) => t + f.amount_cents, 0)

  let exempt = false
  const c = ctx.customer
  if (c?.tax_exempt) {
    const expired = !!c.exempt_cert_expires_on && c.exempt_cert_expires_on < ctx.today
    if (expired)
      warnings.push({
        code: 'exempt_cert_expired',
        message: input.charge_tax_anyway
          ? `Exemption certificate expired ${c.exempt_cert_expires_on}; charging tax.`
          : `Customer is tax-exempt but the certificate expired ${c.exempt_cert_expires_on}. No tax is charged; switch on “Charge tax anyway” if needed.`,
        severity: 'warn'
      })
    exempt = !input.charge_tax_anyway
  }
  const taxable = exempt ? 0 : taxableAfterDiscount + rushTaxable + shippingTaxable
  const tax = exempt ? 0 : applyBp(taxable, ctx.tax_bp)
  const total = afterDiscount + rush + tax + shipping
  const deposit = applyBp(total, input.deposit_bp)

  // Internal profit estimate: revenue before tax and shipping minus garments and ink/labor.
  const revenue = afterDiscount + rush
  const cost = lines.reduce((t, l) => t + l.cost_cents, 0) + totalPieces * ctx.ink_labor_cost_per_piece_cents
  const profit = revenue - cost

  return {
    lines,
    fees,
    total_pieces: totalPieces,
    items_subtotal_cents: itemsSubtotal,
    fees_subtotal_cents: feesSubtotal,
    subtotal_cents: subtotal,
    discount_cents: discount,
    rush_cents: rush,
    shipping_cents: shipping,
    taxable_cents: taxable,
    tax_bp: exempt ? 0 : ctx.tax_bp,
    tax_cents: tax,
    tax_exempt_applied: exempt,
    total_cents: total,
    deposit_cents: deposit,
    paid_cents: input.amount_paid_cents,
    balance_cents: total - input.amount_paid_cents,
    screens,
    cost_cents: cost,
    profit_cents: profit,
    margin_bp: marginBp(cost, revenue),
    warnings
  }
}

function fmt(c: Cents): string {
  return `$${(c / 100).toFixed(2)}`
}
function pct(bp: number): string {
  return `${(bp / 100).toString()}%`
}

/** "Front – 3 color + underbase, Back – 1 color" */
export function imprintSummary(i: ImprintInput, matrixColumnLabel?: string): string {
  const where = i.location === 'custom' ? i.location_custom || 'Custom' : LOCATION_LABELS[i.location]
  let what: string
  if (i.method === 'screen') what = `${i.colors} color${i.colors === 1 ? '' : 's'}${i.underbase ? ' + underbase' : ''}`
  else if (i.method === 'embroidery') what = `embroidery, ${i.stitch_count.toLocaleString('en-US')} stitches`
  else if (i.method === 'dtf' || i.method === 'transfer') what = `${METHOD_LABELS[i.method]}${matrixColumnLabel ? `, ${matrixColumnLabel}` : ''}`
  else what = METHOD_LABELS[i.method]
  const extras = [...i.specialty.map((s) => SPECIALTY_LABELS[s].toLowerCase()), i.print_size !== 'standard' ? i.print_size : ''].filter(Boolean)
  return `${where} – ${what}${extras.length ? ` (${extras.join(', ')})` : ''}`
}
