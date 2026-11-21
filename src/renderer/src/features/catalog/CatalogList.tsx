import { Copy, FileUp, Plus, Shirt } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { formatMoney } from '@shared/money'
import { GARMENT_CATEGORIES, GARMENT_CATEGORY_LABELS, SUPPLIER_LABELS, type Garment } from '@shared/schemas'
import { useAsync } from '../../components/toast'
import { Badge, Button, Checkbox, EmptyState, Input, Loading, PageHeader, Select, Table, Td, Th } from '../../components/ui'
import { api } from '../../lib/api'
import { useGarments, useInvalidate } from '../../lib/queries'
import { CsvImportDialog } from './CsvImport'

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

  return (
    <>
      <PageHeader
        title="Garment catalog"
        subtitle="Blank garments with your cost per size group. Quotes copy the garment, so later cost changes never alter old quotes."
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
              <Th className="text-right">2XL / 3XL / 4XL+</Th>
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
                <Td className="text-right tabular">{formatMoney(g.cost_base_cents)}</Td>
                <Td className="text-right text-xs text-slate-600 tabular dark:text-slate-400">
                  {[g.cost_2xl_cents, g.cost_3xl_cents, g.cost_4xl_plus_cents].map((x) => formatMoney(x)).join(' / ')}
                </Td>
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
