import { AlertTriangle, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { bpToPercentString, formatMoney } from '@shared/money'
import type { AutoFeeKey, QuoteBreakdown } from '@shared/pricing/types'
import { newUid, type PricedDoc, type QuoteFee } from '@shared/quote'
import { FEE_BASIS_LABELS } from '@shared/schemas'
import { Button, Card, Checkbox, cx, IntInput, MoneyInput, PercentInput, Select, Switch, Input } from '../../components/ui'
import { useFees } from '../../lib/queries'

const AUTO_LABELS: Record<AutoFeeKey, string> = { screens: 'Screens / setup', digitizing: 'Digitizing', below_min: 'Small order fee', rush: 'Rush' }

export function FeesCard<E extends PricedDoc>({ edit, breakdown, update }: { edit: E; breakdown: QuoteBreakdown; update: (fn: (e: E) => E) => void }) {
  const presets = useFees()
  const autoFees = breakdown.fees.filter((f) => f.auto && f.kind !== 'rush')
  const setFee = (i: number, patch: Partial<QuoteFee>) => update((e) => ({ ...e, fees: e.fees.map((f, j) => (j === i ? { ...f, ...patch } : f)) }))
  const addFee = (presetId: string) => {
    const p = presets.data?.find((x) => String(x.id) === presetId)
    const fee: QuoteFee = p
      ? { uid: newUid(), fee_preset_id: p.id, name: p.name, kind: p.kind, basis: p.basis, quantity: null, amount_cents: p.amount_cents, taxable: p.taxable }
      : { uid: newUid(), fee_preset_id: null, name: 'Custom fee', kind: 'other', basis: 'per_job', quantity: null, amount_cents: 0, taxable: true }
    update((e) => ({ ...e, fees: [...e.fees, fee] }))
  }
  const waived = edit.disabled_auto_fees.filter((k) => k !== 'rush')

  return (
    <Card
      title="Fees"
      actions={
        <Select className="h-7 w-48 text-xs" value="" onChange={(e) => e.target.value && addFee(e.target.value)} aria-label="Add fee">
          <option value="">+ Add fee…</option>
          {(presets.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({formatMoney(p.amount_cents)} {FEE_BASIS_LABELS[p.basis].toLowerCase()})
            </option>
          ))}
          <option value="custom">Custom fee</option>
        </Select>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        {autoFees.map((f) => (
          <div key={f.key} className="flex items-center gap-2">
            <span className="flex-1">
              {f.name}
              <span className="ml-2 text-xs text-slate-500">automatic{f.detail ? ` · ${f.detail}` : ''}</span>
            </span>
            <span className="tabular">{formatMoney(f.amount_cents)}</span>
            <Button size="sm" variant="ghost" title="Waive this fee" aria-label={`Waive ${f.name}`} onClick={() => update((e) => ({ ...e, disabled_auto_fees: [...e.disabled_auto_fees, f.key.replace('auto:', '') as AutoFeeKey] }))}>
              <X className="size-3.5" />
            </Button>
          </div>
        ))}
        {waived.map((k) => (
          <div key={k} className="flex items-center gap-2 text-xs text-slate-500">
            <span className="flex-1 line-through">{AUTO_LABELS[k]} (waived)</span>
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3" />} onClick={() => update((e) => ({ ...e, disabled_auto_fees: e.disabled_auto_fees.filter((x) => x !== k) }))}>
              Charge it
            </Button>
          </div>
        ))}
        {edit.fees.map((f, i) => {
          const line = breakdown.fees.find((x) => x.key === f.uid)
          return (
            <div key={f.uid} className="grid grid-cols-[minmax(0,1fr)_7rem_5rem_6.5rem_auto_6rem_auto] items-center gap-2">
              <Input className="h-8" value={f.name} aria-label="Fee name" onChange={(e) => setFee(i, { name: e.target.value })} invalid={!f.name.trim()} />
              <Select className="h-8 text-xs" value={f.basis} aria-label="Charged" onChange={(e) => setFee(i, { basis: e.target.value as QuoteFee['basis'], quantity: null })}>
                {Object.entries(FEE_BASIS_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
              <IntInput
                className="w-20"
                value={f.quantity ?? line?.quantity ?? 1}
                aria-label={f.basis === 'per_hour' ? 'Hours' : f.basis === 'per_piece' ? 'Pieces' : 'Quantity'}
                onChange={(v) => setFee(i, { quantity: v })}
              />
              <MoneyInput className="w-full" value={f.amount_cents} aria-label="Amount each" onChange={(v) => setFee(i, { amount_cents: v })} />
              <Checkbox className="text-xs" checked={f.taxable} onChange={(v) => setFee(i, { taxable: v })} label="Tax" />
              <span className="text-right tabular">{formatMoney(line?.amount_cents ?? 0)}</span>
              <Button size="sm" variant="ghost" aria-label={`Remove ${f.name}`} onClick={() => update((e) => ({ ...e, fees: e.fees.filter((_, j) => j !== i) }))}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          )
        })}
        {!autoFees.length && !edit.fees.length && !waived.length && <p className="text-xs text-slate-500">Screen, digitizing and small-order fees are added automatically from your pricing rules.</p>}
        {edit.fees.some((f) => f.basis === 'per_piece' && f.quantity != null) && (
          <p className="text-xs text-slate-500">
            <Plus className="inline size-3" /> Per-piece fees follow the total piece count unless you change their quantity.
          </p>
        )}
      </div>
    </Card>
  )
}

function Row({ label, value, strong, muted, children }: { label: React.ReactNode; value: string; strong?: boolean; muted?: boolean; children?: React.ReactNode }) {
  return (
    <div className={cx('flex items-center justify-between gap-2 py-1', strong && 'border-t border-slate-200 pt-2 text-base font-semibold dark:border-slate-700', muted && 'text-slate-500')}>
      <span className="flex items-center gap-2">
        {label}
        {children}
      </span>
      <span className="tabular">{value}</span>
    </div>
  )
}

export function TotalsCard<E extends PricedDoc>({ edit, breakdown: b, defaultTaxBp, update, showDeposit = true }: { edit: E; breakdown: QuoteBreakdown; defaultTaxBp: number; update: (fn: (e: E) => E) => void; showDeposit?: boolean }) {
  const exemptWarning = b.warnings.find((w) => w.code === 'exempt_cert_expired')
  const margin = b.margin_bp
  return (
    <Card title="Totals" bodyClassName="p-4 text-sm">
      <Row label={`Items (${b.total_pieces} pcs)`} value={formatMoney(b.items_subtotal_cents)} muted />
      <Row label="Fees" value={formatMoney(b.fees_subtotal_cents)} muted />
      <Row label="Subtotal" value={formatMoney(b.subtotal_cents)} />
      <div className="flex items-center justify-between gap-2 py-1">
        <span className="flex items-center gap-1.5">
          Discount
          <Select className="h-7 w-14 px-1 text-xs" value={edit.discount_mode} aria-label="Discount type" onChange={(e) => update((x) => ({ ...x, discount_mode: e.target.value as PricedDoc['discount_mode'], discount_value: 0 }))}>
            <option value="percent">%</option>
            <option value="flat">$</option>
          </Select>
          {edit.discount_mode === 'percent' ? (
            <PercentInput className="w-20" value={edit.discount_value} aria-label="Discount percent" onChange={(v) => update((x) => ({ ...x, discount_value: Math.min(v, 10000) }))} />
          ) : (
            <MoneyInput className="w-24" value={edit.discount_value} aria-label="Discount amount" onChange={(v) => update((x) => ({ ...x, discount_value: v }))} />
          )}
        </span>
        <span className="tabular">{b.discount_cents ? `−${formatMoney(b.discount_cents)}` : formatMoney(0)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 py-1">
        <Switch checked={edit.rush} onChange={(v) => update((x) => ({ ...x, rush: v }))} label="Rush" />
        <span className="tabular">{formatMoney(b.rush_cents)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 py-1">
        <span className="flex items-center gap-1.5">
          Tax
          {b.tax_exempt_applied ? (
            <span className="text-xs text-emerald-700 dark:text-emerald-400">customer exempt</span>
          ) : (
            <PercentInput
              className="w-20"
              value={edit.tax_bp_override ?? defaultTaxBp}
              aria-label="Tax rate"
              onChange={(v) => update((x) => ({ ...x, tax_bp_override: v === defaultTaxBp ? null : v }))}
            />
          )}
        </span>
        <span className="tabular">{formatMoney(b.tax_cents)}</span>
      </div>
      {exemptWarning && (
        <div className="my-1 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          <AlertTriangle className="mr-1 inline size-3.5" />
          {exemptWarning.message}
          <div className="mt-1.5">
            <Switch checked={edit.charge_tax_anyway} onChange={(v) => update((x) => ({ ...x, charge_tax_anyway: v }))} label="Charge tax anyway" />
          </div>
        </div>
      )}
      {b.shipping_cents > 0 && <Row label="Shipping" value={formatMoney(b.shipping_cents)} />}
      <Row label="Total" value={formatMoney(b.total_cents)} strong />
      {b.paid_cents > 0 && (
        <>
          <Row label="Received" value={`−${formatMoney(b.paid_cents)}`} muted />
          <Row label={b.balance_cents < 0 ? 'Credit' : 'Balance due'} value={formatMoney(Math.abs(b.balance_cents))} strong />
        </>
      )}
      {showDeposit && (
      <div className="flex items-center justify-between gap-2 py-1">
        <span className="flex items-center gap-1.5">
          Deposit
          <PercentInput className="w-20" value={edit.deposit_bp} aria-label="Deposit percent" onChange={(v) => update((x) => ({ ...x, deposit_bp: Math.min(v, 10000) }))} />
        </span>
        <span className="tabular">{formatMoney(b.deposit_cents)}</span>
      </div>
      )}

      <div className="mt-3 rounded-md border border-dashed border-slate-300 p-2.5 text-xs dark:border-slate-700">
        <div className="mb-1 font-semibold text-slate-500">Internal only</div>
        <div className="flex justify-between">
          <span>Cost (garments + ink/labor)</span>
          <span className="tabular">{formatMoney(b.cost_cents)}</span>
        </div>
        <div className="flex justify-between">
          <span>Est. profit</span>
          <span className={cx('tabular font-semibold', b.profit_cents < 0 && 'text-red-600')}>{formatMoney(b.profit_cents)}</span>
        </div>
        <div className="flex justify-between">
          <span>Margin</span>
          <span className={cx('tabular font-semibold', margin != null && margin < 2500 ? 'text-amber-600' : 'text-emerald-700 dark:text-emerald-400')}>{margin == null ? '–' : `${bpToPercentString(margin)}%`}</span>
        </div>
        {b.screens > 0 && (
          <div className="flex justify-between text-slate-500">
            <span>Screens</span>
            <span className="tabular">{b.screens}</span>
          </div>
        )}
      </div>
    </Card>
  )
}
