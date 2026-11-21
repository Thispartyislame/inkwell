import { Copy, FileUp, Plus, Shirt } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { bpToPercentString, formatMoney } from '@shared/money'
import { garmentCosts, garmentGroupPrices, type GarmentGroupPrice } from '@shared/pricing/garment'
import { SIZE_GROUP_LABELS } from '@shared/sizes'
import { GARMENT_CATEGORIES, GARMENT_CATEGORY_LABELS, SUPPLIER_LABELS, type Garment, type PricingRules } from '@shared/schemas'
import { useAsync } from '../../components/toast'
import { Badge, Button, Checkbox, EmptyState, Input, Loading, PageHeader, Select, Table, Td, Th } from '../../components/ui'
import { api } from '../../lib/api'
import { useGarments, useInvalidate, useRules } from '../../lib/queries'
import { CsvImportDialog } from './CsvImport'

/** Cost, sell price and margin columns for one garment (blank garment, before printing). */
function SellCells({ g, rules }: { g: Garment; rules: PricingRules | undefined }) {
  let p: GarmentGroupPrice[] | null = null
  try {
    p = rules ? garmentGroupPrices(garmentCosts(g), rules) : null
  } catch {
    p = null
  }
  const sell = (r: GarmentGroupPrice | undefined) => (r && r.costCents > 0 ? formatMoney(r.sellCents) : '–')
  return (
    <>
      <Td className="text-right text-slate-600 tabular dark:text-slate-400">{formatMoney(g.cost_base_cents)}</Td>
      <Td className="text-right font-medium tabular">{sell(p?.[0])}</Td>
      <Td className="text-right tabular">{p?.[0]?.marginBp != null ? `${bpToPercentString(p[0].marginBp)}%` : '–'}</Td>
      <Td className="text-right text-xs whitespace-nowrap text-slate-600 tabular dark:text-slate-400">
        <span title={p ? p.slice(1).map((r) => `${SIZE_GROUP_LABELS[r.group]}: cost ${formatMoney(r.costCents)}, sell ${sell(r)}`).join('\n') : undefined}>{p ? p.slice(1).map(sell).join(' / ') : '–'}</span>
      </Td>
    </>
  )
}

function Swatches({ g }: { g: Garment }) {
  const shown = g.colors.slice(0, 10)
  return (
    <div className="flex items-center gap-0.5" title={g.colors.map((c) => c.name).join(', ')}>
      {shown.map((c) => (
        <span key={c.name} className="size-3.5 rounded-full border border-slate-300 dark:border-slate-600" style={{ background: c.hex }} />
      ))}
      {g.colors.length > shown.length && <span className="ml-1 text-xs text-slate-500">+{g.colors.length - shown.length}</span>}
    </div>
  )
}

export function CatalogList() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [archived, setArchived] = useState(false)
  const [importing, setImporting] = useState(false)
  const navigate = useNavigate()
  const run = useAsync()
  const invalidate = useInvalidate()
  const { data, isLoading } = useGarments({ search, category: category || undefined, includeArchived: archived })
  const rules = useRules()

  return (
    <>
      <PageHeader
        title="Garment catalog"
        subtitle="Blank garments with your cost and the sell price from your pricing rules (before printing; internal only). Quotes copy the garment, so later changes never alter old quotes."
        actions={
          <>
            <Button icon={<FileUp className="size-4" />} onClick={() => setImporting(true)}>
              Import CSV
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/catalog/new')}>
              New garment
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder="Search brand, style, name, color…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search garments" />
        <Select className="w-44" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {GARMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {GARMENT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        <Checkbox checked={archived} onChange={setArchived} label="Show archived" />
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState icon={<Shirt className="size-8" />} title={search || category ? 'No garments match' : 'Your catalog is empty'} action={<Button variant="primary" onClick={() => navigate('/catalog/new')}>Add a garment</Button>}>
          Add garments by hand or import a price list CSV from your distributor.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Style</Th>
              <Th>Name</Th>
              <Th>Category</Th>
              <Th>Colors</Th>
              <Th>Sizes</Th>
              <Th className="text-right">Cost S–XL</Th>
              <Th className="text-right">Sell S–XL</Th>
              <Th className="text-right">Margin</Th>
              <Th className="text-right">Sell 2XL/3XL/4XL+</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((g) => (
              <tr key={g.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => navigate(`/catalog/${g.id}`)}>
                <Td>
                  <div className="font-medium">{[g.brand, g.style_number].filter(Boolean).join(' ') || '–'}</div>
                  <div className="text-xs text-slate-500">{g.supplier === 'other' ? g.supplier_other || '' : SUPPLIER_LABELS[g.supplier]}</div>
                </Td>
                <Td>
                  {g.name}
                  {!g.active && <Badge className="ml-2">Inactive</Badge>}
                  {g.archived_at && <Badge className="ml-2">Archived</Badge>}
                </Td>
                <Td>{GARMENT_CATEGORY_LABELS[g.category]}</Td>
                <Td>
                  <Swatches g={g} />
                </Td>
                <Td className="text-xs text-slate-600 dark:text-slate-400">{g.sizes.length > 6 ? `${g.sizes[0]}–${g.sizes[g.sizes.length - 1]}` : g.sizes.join(' ')}</Td>
                <SellCells g={g} rules={rules.data} />
                <Td className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Duplicate"
                    title="Duplicate"
                    onClick={(e) => {
                      e.stopPropagation()
                      void run(async () => {
                        const d = await api.garments.duplicate(g.id)
                        await invalidate('garments')
                        navigate(`/catalog/${d.id}`)
                      }, 'Garment duplicated')
                    }}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <CsvImportDialog open={importing} onOpenChange={setImporting} />
    </>
  )
}
