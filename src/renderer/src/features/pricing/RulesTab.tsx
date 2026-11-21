import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { garmentPrice } from '@shared/pricing/garment'
import { formatMoney } from '@shared/money'
import { PricingRulesSchema, SPECIALTY_INKS, SPECIALTY_LABELS, type PricingRules, type PricingRulesInput } from '@shared/schemas'
import { useAsync } from '../../components/toast'
import { Button, Card, Field, IntField, Loading, MoneyField, MoneyInput, MultiplierInput, Notice, PercentField, PercentInput, SampleBadge, Select } from '../../components/ui'
import { api } from '../../lib/api'
import { useForm } from '../../lib/form'
import { useInvalidate, useRules } from '../../lib/queries'

export function RulesTab() {
  const { data, isLoading } = useRules()
  if (isLoading || !data) return <Loading />
  return <RulesForm key={data.updated_at} rules={data} />
}

function RulesForm({ rules }: { rules: PricingRules }) {
  const { is_sample: _s, updated_at: _u, ...initial } = rules
  const f = useForm<PricingRulesInput>(initial)
  const v = f.values
  const e = f.errors
  const run = useAsync()
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState(false)

  const setTier = (i: number, patch: Partial<PricingRulesInput['markup_tiers'][number]>) => f.set('markup_tiers', v.markup_tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  const addTier = () => {
    const tiers = [...v.markup_tiers]
    const last = tiers[tiers.length - 1]
    const prevLimit = tiers.length > 1 ? (tiers[tiers.length - 2].up_to_cents ?? 0) : 0
    tiers.splice(tiers.length - 1, 0, { up_to_cents: prevLimit + 1000, value: last.value })
    f.set('markup_tiers', tiers)
  }
  const switchMode = (mode: PricingRulesInput['markup_mode']) => {
    // Convert existing values so the effective markup stays the same: +100% ⇄ ×2.0
    const tiers = v.markup_tiers.map((t) => ({ ...t, value: mode === 'multiplier' ? Math.round((t.value + 10000) / 10) : Math.max(0, t.value * 10 - 10000) }))
    f.patch({ markup_mode: mode, markup_tiers: tiers })
  }

  const save = async () => {
    const data = f.validate(PricingRulesSchema)
    if (!data) return
    setBusy(true)
    const ok = await run(() => api.pricing.saveRules(data).catch((err) => (f.fail(err), Promise.reject(err))), 'Pricing rules saved')
    setBusy(false)
    if (ok) await invalidate('rules')
  }

  const examples = [250, 800, 2000]
  const tierError = Object.entries(e).find(([k]) => k.startsWith('markup_tiers'))?.[1]

  return (
    <form noValidate
      onSubmit={(ev) => {
        ev.preventDefault()
        void save()
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex items-center justify-between">
        <div>{rules.is_sample && <SampleBadge />}</div>
        <Button variant="primary" type="submit" busy={busy}>
          Save rules
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <Card title="Garment markup">
          <div className="flex flex-col gap-3">
            <Field label="Mark up by">
              <Select value={v.markup_mode} onChange={(ev) => switchMode(ev.target.value as PricingRulesInput['markup_mode'])}>
                <option value="percent">Percent over cost</option>
                <option value="multiplier">Multiplier of cost</option>
              </Select>
            </Field>
            <table className="text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-1 font-medium">Garments costing up to</th>
                  <th className="pb-1 font-medium">{v.markup_mode === 'percent' ? 'Markup' : 'Multiplier'}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {v.markup_tiers.map((t, i) => {
                  const last = i === v.markup_tiers.length - 1
                  return (
                    <tr key={i}>
                      <td className="py-1 pr-2">{last ? <span className="text-sm text-slate-500">{v.markup_tiers.length > 1 ? 'Anything more' : 'Any cost'}</span> : <MoneyInput value={t.up_to_cents} onChange={(x) => setTier(i, { up_to_cents: x })} aria-label={`Tier ${i + 1} limit`} />}</td>
                      <td className="py-1 pr-2">
                        {v.markup_mode === 'percent' ? (
                          <PercentInput value={t.value} onChange={(x) => setTier(i, { value: x })} aria-label={`Tier ${i + 1} markup`} />
                        ) : (
                          <MultiplierInput value={t.value} onChange={(x) => setTier(i, { value: x })} aria-label={`Tier ${i + 1} multiplier`} />
                        )}
                      </td>
                      <td>
                        {!last && (
                          <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => f.set('markup_tiers', v.markup_tiers.filter((_, j) => j !== i))} aria-label={`Remove tier ${i + 1}`}>
                            <X className="size-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {tierError && <Notice tone="red">{tierError}</Notice>}
            <Button size="sm" variant="ghost" className="self-start" icon={<Plus className="size-3.5" />} onClick={addTier}>
              Add tier
            </Button>
            <p className="text-xs text-slate-500">
              Example:{' '}
              {examples
                .map((c) => {
                  try {
                    return `${formatMoney(c)} → ${formatMoney(garmentPrice(c, v))}`
                  } catch {
                    return ''
                  }
                })
                .join(' · ')}
            </p>
          </div>
        </Card>

        <Card title="Size upcharges (per piece)">
          <div className="grid grid-cols-2 gap-3">
            <MoneyField label="S–XL" value={v.size_upcharges.base} onChange={(x) => f.set('size_upcharges', { ...v.size_upcharges, base: x })} />
            <MoneyField label="2XL" value={v.size_upcharges['2xl']} onChange={(x) => f.set('size_upcharges', { ...v.size_upcharges, '2xl': x })} />
            <MoneyField label="3XL" value={v.size_upcharges['3xl']} onChange={(x) => f.set('size_upcharges', { ...v.size_upcharges, '3xl': x })} />
            <MoneyField label="4XL and up" value={v.size_upcharges['4xl_plus']} onChange={(x) => f.set('size_upcharges', { ...v.size_upcharges, '4xl_plus': x })} />
          </div>
          <p className="mt-3 text-xs text-slate-500">Added on top of the marked-up garment price. Set these to $0 if your markup already covers bigger sizes’ higher cost.</p>
        </Card>

        <Card title="Underbase (white under ink on dark garments)">
          <div className="flex flex-col gap-3">
            <Select value={v.underbase_mode} onChange={(ev) => f.set('underbase_mode', ev.target.value as PricingRulesInput['underbase_mode'])} aria-label="Underbase pricing">
              <option value="plus_one_color">Counts as one more color in the matrix</option>
              <option value="flat_adder">Flat adder per piece</option>
            </Select>
            {v.underbase_mode === 'flat_adder' && <MoneyField label="Underbase adder per piece" value={v.underbase_adder_cents} onChange={(x) => f.set('underbase_adder_cents', x)} />}
            <p className="text-xs text-slate-500">Either way, the underbase needs its own screen and counts toward the screen fee.</p>
          </div>
        </Card>

        <Card title="Specialty inks and oversize prints (per piece, per imprint)">
          <div className="grid grid-cols-3 gap-3">
            {SPECIALTY_INKS.map((k) => (
              <MoneyField key={k} label={SPECIALTY_LABELS[k]} value={v.specialty_adders[k] ?? 0} onChange={(x) => f.set('specialty_adders', { ...v.specialty_adders, [k]: x })} />
            ))}
            <MoneyField label="Oversized print" value={v.oversize_adders.oversized} onChange={(x) => f.set('oversize_adders', { ...v.oversize_adders, oversized: x })} />
            <MoneyField label="Jumbo print" value={v.oversize_adders.jumbo} onChange={(x) => f.set('oversize_adders', { ...v.oversize_adders, jumbo: x })} />
          </div>
        </Card>

        <Card title="Screens and setup">
          <div className="grid grid-cols-2 gap-3">
            <MoneyField label="Screen / setup fee" value={v.screen_fee_cents} onChange={(x) => f.set('screen_fee_cents', x)} error={e.screen_fee_cents} />
            <Field label="Charged">
              <Select value={v.screen_fee_basis} onChange={(ev) => f.set('screen_fee_basis', ev.target.value as PricingRulesInput['screen_fee_basis'])}>
                <option value="per_screen">Per screen (each color + underbase)</option>
                <option value="per_color">Per ink color (underbase free)</option>
              </Select>
            </Field>
            <PercentField label="Reorder screen discount" value={v.reorder_screen_discount_bp} onChange={(x) => f.set('reorder_screen_discount_bp', x)} error={e.reorder_screen_discount_bp} hint="100% = no screen fees on reorders" />
            <MoneyField label="Embroidery digitizing fee" value={v.digitizing_fee_cents} onChange={(x) => f.set('digitizing_fee_cents', x)} hint="Per new design" />
          </div>
        </Card>

        <Card title="Minimums and rush">
          <div className="grid grid-cols-2 gap-3">
            <IntField label="Minimum order (pieces)" value={v.min_order_qty} onChange={(x) => f.set('min_order_qty', x)} />
            <MoneyField label="Below-minimum fee" value={v.below_min_fee_cents} onChange={(x) => f.set('below_min_fee_cents', x)} />
            <Field label="Rush fee">
              <Select value={v.rush_mode} onChange={(ev) => f.patch({ rush_mode: ev.target.value as PricingRulesInput['rush_mode'], rush_value: 0 })}>
                <option value="percent">Percent of subtotal</option>
                <option value="flat">Flat amount</option>
              </Select>
            </Field>
            {v.rush_mode === 'percent' ? <PercentField label="Rush percent" value={v.rush_value} onChange={(x) => f.set('rush_value', x)} /> : <MoneyField label="Rush amount" value={v.rush_value} onChange={(x) => f.set('rush_value', x)} />}
          </div>
        </Card>
      </div>
    </form>
  )
}
