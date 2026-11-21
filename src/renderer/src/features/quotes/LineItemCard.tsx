import { ArrowDown, ArrowUp, ChevronRight, Copy, CopyPlus, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { colorFromName, isDarkHex } from '@shared/colors'
import { bpToPercentString, formatMoney } from '@shared/money'
import { pickMatrix } from '@shared/pricing/engine'
import { marginBp } from '@shared/pricing/garment'
import { IMPRINT_LOCATIONS, LOCATION_LABELS, PRINT_SIZES, type LineBreakdown, type MatrixForPricing, type PricingWarning } from '@shared/pricing/types'
import { garmentTitle, newImprint, newUid, type PricingBase, type QuoteImprint, type QuoteLine } from '@shared/quote'
import { DECORATION_METHODS, METHOD_LABELS, SPECIALTY_INKS, SPECIALTY_LABELS, type Garment } from '@shared/schemas'
import { normalizeSize, SIZE_GROUP_LABELS, sizeGroup, sortSizes, STANDARD_SIZES, YOUTH_SIZES } from '@shared/sizes'
import { Badge, Button, Checkbox, cx, Input, IntInput, MoneyInput, Select, Switch } from '../../components/ui'
import { useGarments } from '../../lib/queries'
import { GarmentPicker, type GarmentChoice } from './pickers'

const DEFAULT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL']

export function lineFromChoice(c: GarmentChoice, prev: QuoteLine): QuoteLine {
  if (c.kind === 'catalog') {
    const g = c.garment
    const keepColor = g.colors.find((x) => x.name.toLowerCase() === prev.color_name.toLowerCase())
    const color = keepColor ?? g.colors[0] ?? { name: '', hex: '#ffffff', is_dark: false }
    const sizes = g.sizes.length ? g.sizes : DEFAULT_SIZES
    const qty = new Map(prev.sizes.map((s) => [s.size, s.qty]))
    return withColor(
      {
        ...prev,
        garment_id: g.id,
        garment: { brand: g.brand, style_number: g.style_number, name: g.name, category: g.category, supplier: g.supplier, supplier_other: g.supplier_other },
        costs: { base: g.cost_base_cents, '2xl': g.cost_2xl_cents, '3xl': g.cost_3xl_cents, '4xl_plus': g.cost_4xl_plus_cents },
        customer_supplied: false,
        description: '',
        sizes: sizes.map((s) => ({ size: s, qty: qty.get(s) ?? 0 }))
      },
      color
    )
  }
  return {
    ...prev,
    garment_id: null,
    garment: { brand: '', style_number: '', name: '', category: 'other', supplier: 'other', supplier_other: '' },
    costs: { base: 0, '2xl': 0, '3xl': 0, '4xl_plus': 0 },
    customer_supplied: c.customerSupplied,
    description: c.description || (c.customerSupplied ? 'Customer-supplied garment' : ''),
    sizes: prev.sizes.length ? prev.sizes : DEFAULT_SIZES.map((s) => ({ size: s, qty: 0 }))
  }
}

/** Set the garment color; screen imprints whose underbase is still automatic follow it. */
export function withColor(l: QuoteLine, c: { name: string; hex: string; is_dark: boolean }): QuoteLine {
  return {
    ...l,
    color_name: c.name,
    color_hex: c.hex,
    is_dark: c.is_dark,
    imprints: l.imprints.map((i) => (i.method === 'screen' && i.underbase_source === 'auto' ? { ...i, underbase: c.is_dark } : i))
  }
}

function SizeGrid({ line, onChange }: { line: QuoteLine; onChange: (sizes: QuoteLine['sizes']) => void }) {
  const [adding, setAdding] = useState('')
  const total = line.sizes.reduce((t, s) => t + s.qty, 0)
  const present = new Set(line.sizes.map((s) => s.size))
  const suggestions = [...STANDARD_SIZES, ...YOUTH_SIZES, '6XL'].filter((s) => !present.has(s))
  const add = (raw: string) => {
    const s = normalizeSize(raw)
    if (!s || present.has(s)) return
    onChange(sortSizes([...line.sizes.map((x) => x.size), s]).map((size) => ({ size, qty: line.sizes.find((x) => x.size === size)?.qty ?? 0 })))
    setAdding('')
  }
  return (
    <div className="flex flex-wrap items-end gap-1.5">
      {line.sizes.map((s, i) => (
        <label key={s.size} className="group relative flex w-14 flex-col items-center gap-0.5">
          <span className={cx('text-[11px] font-semibold', sizeGroup(s.size) !== 'base' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500')}>{s.size}</span>
          <IntInput
            className="w-14"
            value={s.qty}
            aria-label={`Quantity ${s.size}`}
            onChange={(qty) => onChange(line.sizes.map((x, j) => (j === i ? { ...x, qty } : x)))}
          />
          {s.qty === 0 && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Remove size ${s.size}`}
              className="absolute -top-1 -right-1 hidden rounded-full bg-white text-slate-400 shadow group-hover:block hover:text-red-600 dark:bg-slate-800"
              onClick={() => onChange(line.sizes.filter((_, j) => j !== i))}
            >
              <X className="size-3.5" />
            </button>
          )}
        </label>
      ))}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[11px] text-slate-400">add</span>
        <Input
          className="h-9 w-16 text-xs"
          list="inkwell-sizes"
          value={adding}
          placeholder="+"
          aria-label="Add size"
          tabIndex={-1}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(adding)
            }
          }}
          onBlur={() => adding && add(adding)}
        />
        <datalist id="inkwell-sizes">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <div className="ml-2 flex flex-col items-center gap-0.5">
        <span className="text-[11px] font-semibold text-slate-500">Total</span>
        <span className="flex h-9 min-w-12 items-center justify-center rounded-md bg-slate-100 px-2 text-sm font-semibold tabular dark:bg-slate-800">{total}</span>
      </div>
    </div>
  )
}

function ImprintRow({
  imp,
  matrices,
  customerMatrixId,
  isDark,
  pricePerPiece,
  onChange,
  onRemove
}: {
  imp: QuoteImprint
  matrices: MatrixForPricing[]
  customerMatrixId: number | null
  isDark: boolean
  pricePerPiece: number | undefined
  onChange: (i: QuoteImprint) => void
  onRemove: () => void
}) {
  const set = <K extends keyof QuoteImprint>(k: K, v: QuoteImprint[K]) => onChange({ ...imp, [k]: v })
  const ofMethod = matrices.filter((m) => m.method === imp.method)
  const ctxLike = { matrices, customer: customerMatrixId != null ? { pricing_matrix_id: customerMatrixId } : null } as Parameters<typeof pickMatrix>[1]
  const auto = pickMatrix({ ...imp, matrix_id: null } as never, ctxLike)
  const effective = pickMatrix(imp as never, ctxLike)
  const sizeColumns = effective?.column_kind === 'size' ? effective.columns : null
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-700 dark:bg-slate-800/40">
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] font-medium text-slate-500">Location</span>
        <Select className="h-8 w-32 text-xs" value={imp.location} onChange={(e) => set('location', e.target.value as QuoteImprint['location'])} aria-label="Location">
          {IMPRINT_LOCATIONS.map((l) => (
            <option key={l} value={l}>
              {LOCATION_LABELS[l]}
            </option>
          ))}
        </Select>
      </label>
      {imp.location === 'custom' && <Input className="h-8 w-28 text-xs" value={imp.location_custom} placeholder="e.g. Hood" aria-label="Custom location" onChange={(e) => set('location_custom', e.target.value)} />}
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] font-medium text-slate-500">Method</span>
        <Select
          className="h-8 w-36 text-xs"
          value={imp.method}
          aria-label="Method"
          onChange={(e) => {
            const method = e.target.value as QuoteImprint['method']
            onChange({ ...imp, method, matrix_id: null, underbase: method === 'screen' ? isDark : false, underbase_source: 'auto' })
          }}
        >
          {DECORATION_METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m]}
            </option>
          ))}
        </Select>
      </label>

      {(imp.method === 'screen' || imp.method === 'other') && (
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-slate-500">Colors</span>
          <IntInput className="w-14" value={imp.colors} onChange={(v) => set('colors', v)} aria-label="Ink colors" />
        </label>
      )}
      {imp.method === 'screen' && (
        <div className="flex flex-col gap-0.5 pb-1.5">
          <span className="text-[11px] font-medium text-slate-500">Underbase{isDark && imp.underbase_source === 'auto' ? ' (dark garment)' : ''}</span>
          <Switch checked={imp.underbase} onChange={(v) => onChange({ ...imp, underbase: v, underbase_source: 'manual' })} label="" />
        </div>
      )}
      {imp.method === 'embroidery' && (
        <>
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-slate-500">Stitches</span>
            <IntInput className="w-24" value={imp.stitch_count} onChange={(v) => set('stitch_count', v)} aria-label="Stitch count" />
          </label>
          <Checkbox className="pb-2 text-xs" checked={imp.new_digitizing} onChange={(v) => set('new_digitizing', v)} label="New digitizing" />
        </>
      )}
      {sizeColumns && (
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-slate-500">Print size</span>
          <Select className="h-8 w-44 text-xs" value={imp.transfer_size} onChange={(e) => set('transfer_size', Number(e.target.value))} aria-label="Transfer size">
            {sizeColumns.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label || `Size ${c.value}`}
              </option>
            ))}
          </Select>
        </label>
      )}
      {imp.method === 'screen' && (
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-slate-500">Print size</span>
          <Select className="h-8 w-32 text-xs" value={imp.print_size} onChange={(e) => set('print_size', e.target.value as QuoteImprint['print_size'])} aria-label="Print size">
            {PRINT_SIZES.map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </Select>
        </label>
      )}
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] font-medium text-slate-500">Price matrix</span>
        <Select className="h-8 w-56 text-xs" value={imp.matrix_id ?? ''} onChange={(e) => set('matrix_id', e.target.value ? Number(e.target.value) : null)} aria-label="Price matrix">
          <option value="">Auto{auto ? ` (${auto.name})` : ''}</option>
          {ofMethod.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </label>
      {imp.method === 'screen' && <Checkbox className="pb-2 text-xs" checked={imp.is_reorder} onChange={(v) => set('is_reorder', v)} label="Reorder (screens on file)" />}

      {imp.method === 'screen' && (
        <div className="flex w-full flex-wrap gap-1 pt-0.5">
          {SPECIALTY_INKS.map((s) => {
            const on = imp.specialty.includes(s)
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => set('specialty', on ? imp.specialty.filter((x) => x !== s) : [...imp.specialty, s])}
                className={cx(
                  'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                  on ? 'border-accent bg-accent/10 text-accent' : 'border-slate-300 text-slate-500 hover:border-slate-400 dark:border-slate-600'
                )}
              >
                {SPECIALTY_LABELS[s]}
              </button>
            )
          })}
        </div>
      )}
      <div className="ml-auto flex items-center gap-2 self-center">
        {pricePerPiece != null && (
          <span className="text-xs text-slate-500 tabular" title="Decoration price per piece (internal)">
            {formatMoney(pricePerPiece)}/pc
          </span>
        )}
        <button type="button" className="text-slate-400 hover:text-red-600" onClick={onRemove} aria-label="Remove imprint">
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  )
}

function Breakdown({ line, lb, onOverride }: { line: QuoteLine; lb: LineBreakdown; onOverride: (group: keyof QuoteLine['overrides'], cents: number | null) => void }) {
  const revenue = lb.total_cents
  const m = marginBp(lb.cost_cents, revenue)
  return (
    <div className="mt-2 rounded-md border border-dashed border-amber-300 bg-amber-50/50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/20">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-amber-800 dark:text-amber-300">Pricing breakdown · internal only</span>
        <span className="text-slate-600 dark:text-slate-400">
          Priced at {lb.priced_qty} pcs{lb.priced_qty !== lb.qty ? ` (combined with matching lines)` : ''}
        </span>
      </div>
      {lb.imprints.length > 0 && (
        <ul className="mb-2 space-y-0.5">
          {lb.imprints.map((i) => (
            <li key={i.uid} className="tabular">
              {i.matrix_name ? `${i.matrix_name}: ${i.break_qty}+ pcs, ${i.column_label}` : 'No matrix'} = {formatMoney(i.matrix_cents)}
              {i.adders.map((a) => ` + ${a.label} ${formatMoney(a.cents)}`).join('')} → <strong>{formatMoney(i.per_piece_cents)}/pc</strong>
            </li>
          ))}
        </ul>
      )}
      <table className="w-full tabular">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-0.5 font-medium">Size</th>
            <th className="py-0.5 text-right font-medium">Qty</th>
            <th className="py-0.5 text-right font-medium">Cost</th>
            <th className="py-0.5 text-right font-medium">Garment</th>
            <th className="py-0.5 text-right font-medium">Print</th>
            <th className="py-0.5 text-right font-medium">Upcharge</th>
            <th className="py-0.5 text-right font-medium">Calculated</th>
            <th className="py-0.5 pl-3 text-right font-medium">Unit price</th>
            <th className="py-0.5 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {lb.groups.map((g) => (
            <tr key={g.group} className="border-t border-amber-200/70 dark:border-amber-900/50">
              <td className="py-1">{SIZE_GROUP_LABELS[g.group]}</td>
              <td className="py-1 text-right">{g.qty}</td>
              <td className="py-1 text-right">{formatMoney(g.cost_cents)}</td>
              <td className="py-1 text-right">{formatMoney(g.garment_cents)}</td>
              <td className="py-1 text-right">{formatMoney(g.decoration_cents)}</td>
              <td className="py-1 text-right">{formatMoney(g.upcharge_cents)}</td>
              <td className="py-1 text-right">{formatMoney(g.calculated_unit_cents)}</td>
              <td className="py-1 pl-3">
                <div className="flex items-center justify-end gap-1">
                  {g.overridden && <Badge color="violet">Manual</Badge>}
                  <MoneyInput
                    nullable
                    className="w-24"
                    value={line.overrides[g.group] ?? null}
                    placeholder={(g.calculated_unit_cents / 100).toFixed(2)}
                    onChange={(v) => onOverride(g.group, (v as number | null) ?? null)}
                    aria-label={`Override unit price ${SIZE_GROUP_LABELS[g.group]}`}
                  />
                </div>
              </td>
              <td className="py-1 text-right font-medium">{formatMoney(g.total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex justify-end gap-4 text-slate-600 dark:text-slate-400">
        <span>Garment cost {formatMoney(lb.cost_cents)}</span>
        <span>Margin before fees {m == null ? '–' : `${bpToPercentString(m)}%`}</span>
      </div>
    </div>
  )
}

export function LineItemCard({
  line,
  index,
  count,
  lb,
  warnings,
  base,
  customerMatrixId,
  onChange,
  onDuplicate,
  onRemove,
  onMove,
  onApplyImprintsToAll
}: {
  line: QuoteLine
  index: number
  count: number
  lb: LineBreakdown | undefined
  warnings: PricingWarning[]
  base: PricingBase
  customerMatrixId: number | null
  onChange: (l: QuoteLine) => void
  onDuplicate: () => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
  onApplyImprintsToAll: () => void
}) {
  const { data: garments } = useGarments({ includeArchived: true })
  const catalog: Garment | undefined = garments?.find((g) => g.id === line.garment_id)
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [otherColor, setOtherColor] = useState(false)
  const hasGarment = !!(line.garment_id || line.description || line.customer_supplied)
  const colorInCatalog = catalog?.colors.some((c) => c.name === line.color_name)
  const total = lb?.total_cents ?? 0

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900" aria-label={`Line item ${index + 1}`}>
      <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 dark:border-slate-800">
        <span className="flex size-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {hasGarment ? garmentTitle(line) : 'New line item'}
          {line.color_name && <span className="font-normal text-slate-500"> · {line.color_name}</span>}
        </span>
        <span className="text-sm font-semibold tabular">{formatMoney(total)}</span>
        <div className="ml-2 flex items-center">
          <Button size="sm" variant="ghost" title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" title="Move down" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={onDuplicate} title="Same design on another garment or color">
            Duplicate
          </Button>
          <Button size="sm" variant="ghost" aria-label="Remove line" title="Remove line" onClick={onRemove}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_16rem] gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Garment</span>
            <GarmentPicker label={hasGarment ? garmentTitle(line) : ''} autoFocus={!hasGarment} onPick={(c) => onChange(lineFromChoice(c, line))} />
            {!line.garment_id && hasGarment && (
              <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <Input value={line.description} placeholder="Describe the item" aria-label="Item description" onChange={(e) => onChange({ ...line, description: e.target.value })} />
                <Checkbox className="text-xs" checked={line.customer_supplied} onChange={(v) => onChange({ ...line, customer_supplied: v })} label="Customer-supplied" />
              </div>
            )}
            {!line.garment_id && hasGarment && !line.customer_supplied && (
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                Your cost:
                {(['base', '2xl', '3xl', '4xl_plus'] as const).map((g) => (
                  <label key={g} className="flex items-center gap-1">
                    {SIZE_GROUP_LABELS[g]}
                    <MoneyInput className="w-20" value={line.costs[g]} onChange={(v) => onChange({ ...line, costs: { ...line.costs, [g]: v } })} aria-label={`Cost ${SIZE_GROUP_LABELS[g]}`} />
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Color</span>
            {catalog && catalog.colors.length > 0 && !otherColor && (colorInCatalog || !line.color_name) ? (
              <div className="flex items-center gap-2">
                <span className="size-6 shrink-0 rounded border border-slate-300" style={{ background: line.color_hex }} />
                <Select
                  value={line.color_name}
                  aria-label="Garment color"
                  onChange={(e) => {
                    if (e.target.value === '__other') return setOtherColor(true)
                    const c = catalog.colors.find((x) => x.name === e.target.value)
                    if (c) onChange(withColor(line, c))
                  }}
                >
                  {!line.color_name && <option value="">Pick a color</option>}
                  {catalog.colors.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                      {c.is_dark ? ' (dark)' : ''}
                    </option>
                  ))}
                  <option value="__other">Other color…</option>
                </Select>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={line.color_hex}
                  aria-label="Color swatch"
                  className="size-8 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent p-0"
                  onChange={(e) => onChange(withColor(line, { name: line.color_name, hex: e.target.value, is_dark: isDarkHex(e.target.value) }))}
                />
                <Input
                  value={line.color_name}
                  placeholder="Color name"
                  aria-label="Garment color"
                  onChange={(e) => onChange({ ...line, color_name: e.target.value })}
                  onBlur={(e) => {
                    if (line.color_hex === '#ffffff' && e.target.value) onChange(withColor(line, colorFromName(e.target.value)))
                  }}
                />
                <Checkbox className="shrink-0 text-xs" checked={line.is_dark} onChange={(v) => onChange(withColor(line, { name: line.color_name, hex: line.color_hex, is_dark: v }))} label="Dark" />
              </div>
            )}
          </div>
        </div>

        <div>
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Sizes</span>
          <div className="mt-1">
            <SizeGrid line={line} onChange={(sizes) => onChange({ ...line, sizes })} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Imprints</span>
            <div className="flex gap-1">
              {count > 1 && line.imprints.length > 0 && (
                <Button size="sm" variant="ghost" icon={<CopyPlus className="size-3.5" />} onClick={onApplyImprintsToAll}>
                  Apply these imprints to all lines
                </Button>
              )}
              <Button
                size="sm"
                icon={<Plus className="size-3.5" />}
                onClick={() =>
                  onChange({
                    ...line,
                    imprints: [...line.imprints, newImprint({ location: line.imprints.length === 0 ? 'front' : line.imprints.length === 1 ? 'back' : 'left_sleeve', underbase: line.is_dark })]
                  })
                }
              >
                Add imprint
              </Button>
            </div>
          </div>
          {line.imprints.length === 0 && <p className="text-xs text-slate-500">No imprints yet: this line is priced as blank garments.</p>}
          {line.imprints.map((imp, i) => (
            <ImprintRow
              key={imp.uid}
              imp={imp}
              matrices={base.matrices}
              customerMatrixId={customerMatrixId}
              isDark={line.is_dark}
              pricePerPiece={lb?.imprints[i]?.per_piece_cents}
              onChange={(x) => onChange({ ...line, imprints: line.imprints.map((y, j) => (j === i ? x : y)) })}
              onRemove={() => onChange({ ...line, imprints: line.imprints.filter((_, j) => j !== i) })}
            />
          ))}
        </div>

        {warnings.length > 0 && (
          <ul className="flex flex-col gap-1">
            {warnings.map((w, i) => (
              <li key={i} className={cx('text-xs', w.severity === 'warn' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400')}>
                {w.message}
              </li>
            ))}
          </ul>
        )}

        {lb && lb.qty > 0 && (
          <div>
            <button type="button" className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" onClick={() => setShowBreakdown((v) => !v)} aria-expanded={showBreakdown}>
              <ChevronRight className={cx('size-3.5 transition', showBreakdown && 'rotate-90')} />
              Pricing breakdown
              {lb.groups.map((g) => ` · ${SIZE_GROUP_LABELS[g.group]} ${formatMoney(g.unit_cents)}`).join('')}
              {lb.groups.some((g) => g.overridden) && (
                <Badge color="violet" className="ml-1">
                  Manual price
                </Badge>
              )}
            </button>
            {showBreakdown && (
              <Breakdown
                line={line}
                lb={lb}
                onOverride={(group, cents) => {
                  const overrides = { ...line.overrides }
                  if (cents == null) delete overrides[group]
                  else overrides[group] = cents
                  onChange({ ...line, overrides })
                }}
              />
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/** A copy of a line with fresh ids (for Duplicate and Apply-to-all). */
export function cloneLine(l: QuoteLine): QuoteLine {
  return { ...l, uid: newUid(), imprints: l.imprints.map((i) => ({ ...i, uid: newUid() })), sizes: l.sizes.map((s) => ({ ...s })), overrides: { ...l.overrides } }
}
