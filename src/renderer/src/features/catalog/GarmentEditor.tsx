import { Archive, ArchiveRestore, ArrowLeft, Copy, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { colorFromName, isDarkHex } from '@shared/colors'
import { GARMENT_CATEGORIES, GARMENT_CATEGORY_LABELS, GarmentSchema, SUPPLIER_LABELS, SUPPLIERS, type GarmentInput } from '@shared/schemas'
import { normalizeSize, SIZE_GROUP_LABELS, SIZE_GROUPS, sizeGroup, sortSizes, STANDARD_SIZES, YOUTH_SIZES, type SizeGroup } from '@shared/sizes'
import { bpToPercentString, formatMoney } from '@shared/money'
import { garmentCosts, garmentGroupPrices, type GarmentGroupPrice } from '@shared/pricing/garment'
import { useAsync } from '../../components/toast'
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, Field, Input, Loading, MoneyInput, PageHeader, Select, Switch, Textarea, TextField, cx } from '../../components/ui'
import { api } from '../../lib/api'
import { useForm } from '../../lib/form'
import { useGarment, useInvalidate, useRules } from '../../lib/queries'

export const EMPTY_GARMENT: GarmentInput = {
  brand: '',
  style_number: '',
  name: '',
  category: 'tee',
  supplier: 'ss_activewear',
  supplier_other: '',
  colors: [],
  sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
  cost_base_cents: 0,
  cost_2xl_cents: 0,
  cost_3xl_cents: 0,
  cost_4xl_plus_cents: 0,
  notes: '',
  active: true
}

type CostKey = 'cost_base_cents' | 'cost_2xl_cents' | 'cost_3xl_cents' | 'cost_4xl_plus_cents'
const COST_KEYS: Record<SizeGroup, CostKey> = { base: 'cost_base_cents', '2xl': 'cost_2xl_cents', '3xl': 'cost_3xl_cents', '4xl_plus': 'cost_4xl_plus_cents' }

/** Cost inputs per size group with the resulting sell price and margin from the pricing rules. */
function CostAndSellCard({ values, onChange, errors, groupsUsed }: { values: GarmentInput; onChange: (k: CostKey, v: number) => void; errors: Record<string, string>; groupsUsed: Set<SizeGroup> }) {
  const rules = useRules()
  let rows: GarmentGroupPrice[] | null = null
  try {
    rows = rules.data ? garmentGroupPrices(garmentCosts(values), rules.data) : null
  } catch {
    rows = null
  }
  return (
    <Card title="Cost and sell price">
      <table className="w-full text-sm tabular">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="pb-1 font-medium">Size</th>
            <th className="pb-1 font-medium">Your cost</th>
            <th className="pb-1 text-right font-medium">Sell</th>
            <th className="pb-1 pl-3 text-right font-medium">Margin</th>
          </tr>
        </thead>
        <tbody>
          {SIZE_GROUPS.map((g, i) => {
            const r = rows?.[i]
            const unused = g !== 'base' && !groupsUsed.has(g)
            return (
              <tr key={g} className={unused ? 'opacity-50' : ''} title={unused ? 'Not offered in the selected sizes' : undefined}>
                <td className="py-1 pr-2 text-xs font-medium whitespace-nowrap">{SIZE_GROUP_LABELS[g]}</td>
                <td className="py-1 pr-2">
                  <MoneyInput value={values[COST_KEYS[g]]} onChange={(x) => onChange(COST_KEYS[g], x)} invalid={!!errors[COST_KEYS[g]]} aria-label={`Cost ${SIZE_GROUP_LABELS[g]}`} className="w-24" />
                </td>
                <td className="py-1 pl-2 text-right font-medium whitespace-nowrap" title={r && r.upchargeCents ? `${formatMoney(r.markedUpCents)} + ${formatMoney(r.upchargeCents)} size upcharge` : undefined}>
                  {r && r.costCents > 0 ? formatMoney(r.sellCents) : '–'}
                </td>
                <td className="py-1 pl-3 text-right whitespace-nowrap text-slate-600 dark:text-slate-400">{r?.marginBp != null ? `${bpToPercentString(r.marginBp)}%` : '–'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-slate-500">
        Sell = your cost marked up by the{' '}
        <Link to="/pricing/rules" className="underline">
          pricing rules
        </Link>{' '}
        plus any size upcharge, for the blank garment before printing. Internal only; never shown to customers.
      </p>
    </Card>
  )
}

export function GarmentEditor() {
  const id = Number(useParams().id ?? 0)
  const q = useGarment(id)
  if (id && q.isLoading) return <Loading />
  if (id && !q.data) return <EmptyState title="Garment not found" />
  return <Editor key={id} id={id} />
}

function Editor({ id }: { id: number }) {
  const q = useGarment(id)
  const g = q.data
  const navigate = useNavigate()
  const run = useAsync()
  const invalidate = useInvalidate()
  const initial: GarmentInput = g ? (Object.fromEntries(Object.keys(EMPTY_GARMENT).map((k) => [k, g[k as keyof GarmentInput]])) as GarmentInput) : EMPTY_GARMENT
  const f = useForm<GarmentInput>(initial)
  const v = f.values
  const e = f.errors
  const [newColor, setNewColor] = useState('')
  const [customSize, setCustomSize] = useState('')
  const [busy, setBusy] = useState(false)
  const [archiving, setArchiving] = useState(false)

  const addColor = () => {
    const names = newColor.split(',').map((s) => s.trim()).filter(Boolean)
    const existing = new Set(v.colors.map((c) => c.name.toLowerCase()))
    const add = names.filter((n) => !existing.has(n.toLowerCase())).map(colorFromName)
    if (add.length) f.set('colors', [...v.colors, ...add])
    setNewColor('')
  }
  const toggleSize = (s: string) => f.set('sizes', v.sizes.includes(s) ? v.sizes.filter((x) => x !== s) : sortSizes([...v.sizes, s]))
  const groupsUsed = new Set(v.sizes.map(sizeGroup))

  const save = async () => {
    const data = f.validate(GarmentSchema, { ...v, id: id || undefined })
    if (!data) return
    setBusy(true)
    const saved = await run(() => api.garments.save(data).catch((err) => (f.fail(err), Promise.reject(err))), id ? 'Garment saved' : 'Garment added')
    setBusy(false)
    if (saved) {
      await invalidate('garments', 'garment')
      f.setDirty(false)
      if (!id) navigate(`/catalog/${saved.id}`, { replace: true })
    }
  }

  return (
    <form noValidate
      onSubmit={(ev) => {
        ev.preventDefault()
        void save()
      }}
    >
      <PageHeader
        back={
          <Link to="/catalog" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-3" /> Catalog
          </Link>
        }
        title={
          <span className="flex items-center gap-2">
            {id ? [v.brand, v.style_number].filter(Boolean).join(' ') || v.name : 'New garment'}
            {g?.archived_at && <Badge>Archived</Badge>}
          </span>
        }
        actions={
          <>
            {id > 0 && (
              <>
                <Button
                  icon={<Copy className="size-4" />}
                  onClick={() =>
                    run(async () => {
                      const d = await api.garments.duplicate(id)
                      await invalidate('garments')
                      navigate(`/catalog/${d.id}`)
                    }, 'Garment duplicated')
                  }
                >
                  Duplicate
                </Button>
                {g?.archived_at ? (
                  <Button icon={<ArchiveRestore className="size-4" />} onClick={() => run(async () => (await api.garments.restore(id), invalidate('garments', 'garment')), 'Garment restored')}>
                    Restore
                  </Button>
                ) : (
                  <Button icon={<Archive className="size-4" />} onClick={() => setArchiving(true)}>
                    Archive
                  </Button>
                )}
              </>
            )}
            <Button variant="primary" type="submit" busy={busy}>
              Save
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 flex flex-col gap-5">
          <Card title="Garment">
            <div className="grid grid-cols-3 gap-3">
              <TextField label="Brand" value={v.brand} onChange={(x) => f.set('brand', x)} error={e.brand} autoFocus={!id} />
              <TextField label="Style number" value={v.style_number} onChange={(x) => f.set('style_number', x)} error={e.style_number} />
              <Field label="Category">
                <Select value={v.category} onChange={(ev) => f.set('category', ev.target.value as GarmentInput['category'])}>
                  {GARMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {GARMENT_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <TextField className="col-span-3" label="Name" value={v.name} onChange={(x) => f.set('name', x)} error={e.name} placeholder="Heavy Cotton T-Shirt" />
              <Field label="Supplier">
                <Select value={v.supplier} onChange={(ev) => f.set('supplier', ev.target.value as GarmentInput['supplier'])}>
                  {SUPPLIERS.map((s) => (
                    <option key={s} value={s}>
                      {SUPPLIER_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              {v.supplier === 'other' && <TextField label="Supplier name" value={v.supplier_other} onChange={(x) => f.set('supplier_other', x)} />}
            </div>
          </Card>

          <Card title={`Colors (${v.colors.length})`}>
            <div className="mb-3 flex gap-2">
              <Input
                value={newColor}
                onChange={(ev) => setNewColor(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') {
                    ev.preventDefault()
                    addColor()
                  }
                }}
                placeholder="Add colors: Black, Navy, Sport Grey"
                aria-label="New color names"
              />
              <Button icon={<Plus className="size-4" />} onClick={addColor} disabled={!newColor.trim()}>
                Add
              </Button>
            </div>
            {v.colors.length === 0 ? (
              <p className="text-sm text-slate-500">No colors yet. Swatches are guessed from the name; click one to adjust it.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {v.colors.map((c, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <input
                      type="color"
                      value={c.hex}
                      aria-label={`Swatch for ${c.name}`}
                      className="size-6 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent p-0"
                      onChange={(ev) => f.set('colors', v.colors.map((x, j) => (j === i ? { ...x, hex: ev.target.value, is_dark: isDarkHex(ev.target.value) } : x)))}
                    />
                    <Input
                      className="h-7"
                      value={c.name}
                      aria-label="Color name"
                      onChange={(ev) => f.set('colors', v.colors.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))}
                    />
                    <Checkbox
                      className="shrink-0 text-xs text-slate-600"
                      checked={c.is_dark}
                      label="Dark"
                      onChange={(dark) => f.set('colors', v.colors.map((x, j) => (j === i ? { ...x, is_dark: dark } : x)))}
                    />
                    <button type="button" className="text-slate-400 hover:text-red-600" aria-label={`Remove ${c.name}`} onClick={() => f.set('colors', v.colors.filter((_, j) => j !== i))}>
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {e.colors && <p className="mt-2 text-xs text-red-600">{e.colors}</p>}
            <p className="mt-3 text-xs text-slate-500">“Dark” colors get a white underbase suggested on screen-print imprints.</p>
          </Card>

          <Card title="Sizes">
            <div className="flex flex-col gap-3">
              {[STANDARD_SIZES, YOUTH_SIZES].map((set, k) => (
                <div key={k} className="flex flex-wrap gap-1.5">
                  {set.map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => toggleSize(s)}
                      aria-pressed={v.sizes.includes(s)}
                      className={cx(
                        'h-8 min-w-11 rounded-md border px-2 text-sm font-medium',
                        v.sizes.includes(s) ? 'border-accent bg-accent text-accent-fg' : 'border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-600 dark:text-slate-300'
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-1.5">
                {v.sizes
                  .filter((s) => !(STANDARD_SIZES as readonly string[]).includes(s) && !(YOUTH_SIZES as readonly string[]).includes(s))
                  .map((s) => (
                    <Badge key={s} color="blue">
                      {s}
                      <button type="button" aria-label={`Remove ${s}`} onClick={() => toggleSize(s)}>
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                <Input
                  className="h-8 w-36"
                  value={customSize}
                  placeholder="Custom size, Enter"
                  aria-label="Custom size"
                  onChange={(ev) => setCustomSize(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') {
                      ev.preventDefault()
                      const s = normalizeSize(customSize)
                      if (s && !v.sizes.includes(s)) toggleSize(s)
                      setCustomSize('')
                    }
                  }}
                />
              </div>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <CostAndSellCard values={v} onChange={(k, x) => f.set(k, x)} errors={e} groupsUsed={groupsUsed} />
          <Card title="Status">
            <Switch checked={v.active} onChange={(x) => f.set('active', x)} label="Active" hint="Inactive garments stay in the catalog but are hidden when building quotes." />
          </Card>
          <Card title="Notes">
            <Textarea rows={4} value={v.notes} onChange={(ev) => f.set('notes', ev.target.value)} />
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title="Archive garment?"
        confirmLabel="Archive"
        onConfirm={async () => {
          await run(async () => (await api.garments.archive(id), invalidate('garments', 'garment')), 'Garment archived')
          navigate('/catalog')
        }}
      >
        It will be hidden from the catalog and quote builder. Existing quotes keep their copy of it. You can restore it with “Show archived”.
      </ConfirmDialog>
    </form>
  )
}
