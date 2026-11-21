import { ArrowLeft, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { COLUMN_KIND_LABELS, DECORATION_METHODS, METHOD_LABELS, PricingMatrixSchema, type MatrixColumn, type PricingMatrixInput } from '@shared/schemas'
import { useAsync } from '../../components/toast'
import { Badge, Button, Card, EmptyState, Field, Input, IntInput, Loading, MoneyField, MoneyInput, Notice, PageHeader, SampleBadge, Select, Switch, Textarea, TextField } from '../../components/ui'
import { api } from '../../lib/api'
import { useForm } from '../../lib/form'
import { useInvalidate, useMatrix } from '../../lib/queries'

const KIND_FOR_METHOD: Record<PricingMatrixInput['method'], PricingMatrixInput['column_kind']> = {
  screen: 'colors',
  embroidery: 'stitches',
  dtf: 'size',
  transfer: 'size',
  other: 'colors'
}

const NEW_MATRIX: PricingMatrixInput = {
  name: '',
  method: 'screen',
  column_kind: 'colors',
  breaks: [12, 24, 48, 72, 144],
  columns: [1, 2, 3, 4].map((n) => ({ value: n, label: '' })),
  prices: Array.from({ length: 5 }, () => [0, 0, 0, 0]),
  above_max_rule: 'per_extra_color',
  above_max_adder_cents: 0,
  is_default: false,
  notes: ''
}

export function columnHeading(kind: PricingMatrixInput['column_kind'], c: MatrixColumn): string {
  if (c.label) return c.label
  if (kind === 'colors') return `${c.value} color${c.value === 1 ? '' : 's'}`
  if (kind === 'stitches') return `≤ ${c.value.toLocaleString()} st.`
  return `Size ${c.value}`
}

export function MatrixEditor() {
  const param = useParams().id
  const id = param === 'new' ? 0 : Number(param)
  const q = useMatrix(id)
  if (id && q.isLoading) return <Loading />
  if (id && !q.data) return <EmptyState title="Matrix not found" />
  return <Editor key={id} id={id} />
}

function Editor({ id }: { id: number }) {
  const q = useMatrix(id)
  const m = q.data
  const navigate = useNavigate()
  const run = useAsync()
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState(false)
  const initial: PricingMatrixInput = m
    ? { name: m.name, method: m.method, column_kind: m.column_kind, breaks: m.breaks, columns: m.columns, prices: m.prices, above_max_rule: m.above_max_rule, above_max_adder_cents: m.above_max_adder_cents, is_default: m.is_default, notes: m.notes }
    : NEW_MATRIX
  const f = useForm<PricingMatrixInput>(initial)
  const v = f.values
  const e = f.errors
  const kind = v.column_kind

  const setCell = (r: number, c: number, cents: number) => f.set('prices', v.prices.map((row, i) => (i === r ? row.map((x, j) => (j === c ? cents : x)) : row)))
  const setBreak = (r: number, qty: number) => f.set('breaks', v.breaks.map((b, i) => (i === r ? qty : b)))
  const setColumn = (c: number, col: Partial<MatrixColumn>) => f.set('columns', v.columns.map((x, j) => (j === c ? { ...x, ...col } : x)))

  const addBreak = () => {
    const last = v.breaks[v.breaks.length - 1] ?? 0
    f.patch({ breaks: [...v.breaks, last ? last * 2 : 12], prices: [...v.prices, [...(v.prices[v.prices.length - 1] ?? v.columns.map(() => 0))]] })
  }
  const removeBreak = (r: number) => f.patch({ breaks: v.breaks.filter((_, i) => i !== r), prices: v.prices.filter((_, i) => i !== r) })
  const addColumn = () => {
    const last = v.columns[v.columns.length - 1]?.value ?? 0
    const step = kind === 'stitches' ? 5000 : 1
    f.patch({
      columns: [...v.columns, { value: last + step, label: '' }],
      prices: v.prices.map((row) => [...row, (row[row.length - 1] ?? 0) + (kind === 'colors' ? v.above_max_adder_cents : 0)])
    })
  }
  const removeColumn = (c: number) => f.patch({ columns: v.columns.filter((_, j) => j !== c), prices: v.prices.map((row) => row.filter((_, j) => j !== c)) })

  const save = async () => {
    const data = f.validate(PricingMatrixSchema, { ...v, id: id || undefined })
    if (!data) return
    setBusy(true)
    const saved = await run(() => api.pricing.saveMatrix(data).catch((err) => (f.fail(err), Promise.reject(err))), 'Matrix saved')
    setBusy(false)
    if (saved) {
      await invalidate('matrices', 'matrix')
      f.setDirty(false)
      if (!id) navigate(`/pricing/matrices/${saved.id}`, { replace: true })
    }
  }

  const gridErrors = Object.entries(e).filter(([k]) => k.startsWith('breaks') || k.startsWith('columns') || k === 'prices')

  return (
    <form noValidate
      onSubmit={(ev) => {
        ev.preventDefault()
        void save()
      }}
    >
      <PageHeader
        back={
          <Link to="/pricing/matrices" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-3" /> Pricing
          </Link>
        }
        title={
          <span className="flex items-center gap-2">
            {id ? v.name || 'Untitled matrix' : 'New matrix'}
            {m?.is_sample && <SampleBadge />}
            {m?.archived_at && <Badge>Archived</Badge>}
          </span>
        }
        actions={
          <Button variant="primary" type="submit" busy={busy}>
            Save matrix
          </Button>
        }
      />

      <div className="flex flex-col gap-5">
        <Card title="Price per piece, per location" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                    Min qty ↓ / {COLUMN_KIND_LABELS[kind]} →
                  </th>
                  {v.columns.map((c, j) => (
                    <th key={j} className="border-b border-slate-200 bg-slate-50 px-1.5 py-1.5 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-center gap-1">
                        {kind === 'size' ? (
                          <Input className="h-7 w-32 text-xs" value={c.label} placeholder={`Size ${c.value}`} onChange={(ev) => setColumn(j, { label: ev.target.value })} aria-label={`Column ${j + 1} label`} />
                        ) : (
                          <IntInput className="w-24" value={c.value} onChange={(n) => setColumn(j, { value: n })} aria-label={`Column ${j + 1} ${kind}`} invalid={!!e[`columns.${j}`]} />
                        )}
                        <button type="button" className="text-slate-400 hover:text-red-600 disabled:opacity-30" disabled={v.columns.length <= 1} onClick={() => removeColumn(j)} aria-label={`Remove column ${j + 1}`}>
                          <X className="size-3.5" />
                        </button>
                      </div>
                      <div className="mt-0.5 text-left text-[10px] font-normal text-slate-400">{columnHeading(kind, c)}</div>
                    </th>
                  ))}
                  <th className="border-b border-slate-200 bg-slate-50 px-2 dark:border-slate-800 dark:bg-slate-900">
                    <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={addColumn}>
                      Column
                    </Button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {v.breaks.map((b, r) => (
                  <tr key={r}>
                    <td className="sticky left-0 border-b border-slate-100 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-center gap-1">
                        <IntInput className="w-20" value={b} onChange={(n) => setBreak(r, n)} aria-label={`Quantity break ${r + 1}`} invalid={!!e[`breaks.${r}`]} />
                        <span className="text-xs text-slate-400">+</span>
                        <button type="button" className="ml-1 text-slate-400 hover:text-red-600 disabled:opacity-30" disabled={v.breaks.length <= 1} onClick={() => removeBreak(r)} aria-label={`Remove break ${b}`}>
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </td>
                    {v.columns.map((_, c) => (
                      <td key={c} className="border-b border-slate-100 px-1.5 py-1 dark:border-slate-800">
                        <MoneyInput className="w-[5.5rem]" value={v.prices[r]?.[c] ?? 0} onChange={(x) => setCell(r, c, x)} aria-label={`Price for ${b}+ pieces, column ${c + 1}`} />
                      </td>
                    ))}
                    <td className="border-b border-slate-100 dark:border-slate-800" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={addBreak}>
              Quantity break
            </Button>
            <p className="text-xs text-slate-500">Tab moves across a row. Each row applies from its quantity up to the next row.</p>
          </div>
          {gridErrors.length > 0 && (
            <div className="px-3 pb-3">
              <Notice tone="red">{gridErrors[0][1]}</Notice>
            </div>
          )}
        </Card>

        <div className="grid grid-cols-3 gap-5">
          <Card title="Matrix">
            <div className="flex flex-col gap-3">
              <TextField label="Name" value={v.name} onChange={(x) => f.set('name', x)} error={e.name} autoFocus={!id} />
              <Field label="Decoration method">
                <Select
                  value={v.method}
                  onChange={(ev) => {
                    const method = ev.target.value as PricingMatrixInput['method']
                    f.patch({ method, column_kind: KIND_FOR_METHOD[method] })
                  }}
                >
                  {DECORATION_METHODS.map((x) => (
                    <option key={x} value={x}>
                      {METHOD_LABELS[x]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Columns are">
                <Select value={v.column_kind} onChange={(ev) => f.set('column_kind', ev.target.value as PricingMatrixInput['column_kind'])}>
                  {Object.entries(COLUMN_KIND_LABELS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Switch checked={v.is_default} onChange={(x) => f.set('is_default', x)} label={`Default for ${METHOD_LABELS[v.method].toLowerCase()}`} />
            </div>
          </Card>
          <Card title={kind === 'stitches' ? 'Above the last column' : kind === 'size' ? 'Larger than the last size' : 'More colors than the last column'}>
            <div className="flex flex-col gap-3">
              <Select value={v.above_max_rule} onChange={(ev) => f.set('above_max_rule', ev.target.value as PricingMatrixInput['above_max_rule'])} aria-label="Above max rule">
                <option value="per_extra_color">Last column + adder for each extra {kind === 'stitches' ? '1,000 stitches' : kind === 'size' ? 'size step' : 'color'}</option>
                <option value="use_last">Use the last column’s price</option>
                <option value="not_allowed">Not allowed (warn on the quote)</option>
              </Select>
              {v.above_max_rule === 'per_extra_color' && <MoneyField label="Adder per piece" value={v.above_max_adder_cents} onChange={(x) => f.set('above_max_adder_cents', x)} />}
            </div>
          </Card>
          <Card title="Notes">
            <Textarea rows={3} value={v.notes} onChange={(ev) => f.set('notes', ev.target.value)} />
          </Card>
        </div>
      </div>
    </form>
  )
}
