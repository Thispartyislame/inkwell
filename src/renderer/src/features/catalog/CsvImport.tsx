import Papa from 'papaparse'
import { FileUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CSV_FIELD_LABELS, CSV_FIELDS, groupCsvRows, guessMapping, type CsvMapping } from '@shared/csv-import'
import { formatMoney } from '@shared/money'
import { SUPPLIER_LABELS, SUPPLIERS, type GarmentInput } from '@shared/schemas'
import { useToast } from '../../components/toast'
import { Button, Dialog, Field, Notice, Select, Table, Td, Th } from '../../components/ui'
import { api } from '../../lib/api'
import { useInvalidate } from '../../lib/queries'

interface Parsed {
  fileName: string
  headers: string[]
  rows: Record<string, string>[]
}

export function CsvImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [file, setFile] = useState<Parsed | null>(null)
  const [mapping, setMapping] = useState<CsvMapping | null>(null)
  const [supplier, setSupplier] = useState<GarmentInput['supplier']>('ss_activewear')
  const [mode, setMode] = useState<'merge' | 'skip'>('merge')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const invalidate = useInvalidate()

  const reset = () => {
    setFile(null)
    setMapping(null)
  }

  const pick = async () => {
    try {
      const r = await api.garments.pickCsv()
      if (!r) return
      const parsed = Papa.parse<Record<string, string>>(r.text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() })
      const headers = (parsed.meta.fields ?? []).filter(Boolean)
      if (!headers.length || !parsed.data.length) throw new Error('That file has no rows, or no header row.')
      setFile({ fileName: r.fileName, headers, rows: parsed.data })
      setMapping(guessMapping(headers))
    } catch (e) {
      toast.error(e)
    }
  }

  const preview = useMemo(() => {
    if (!file || !mapping) return null
    const r = groupCsvRows(file.rows, mapping)
    return { ...r, garments: r.garments.map((g) => ({ ...g, supplier })) }
  }, [file, mapping, supplier])

  const missing = mapping && !mapping.name && !mapping.style_number

  const doImport = async () => {
    if (!preview) return
    setBusy(true)
    try {
      const r = await api.garments.importRows(preview.garments, mode)
      await invalidate('garments')
      toast.success(`Imported: ${r.created} new, ${r.updated} updated, ${r.skipped} skipped`)
      reset()
      onOpenChange(false)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      wide
      title="Import garments from CSV"
      description="Distributor price lists (one row per style, color and size) and simple one-row-per-style files both work."
      footer={
        file && (
          <>
            <Button onClick={reset}>Choose another file</Button>
            <Button variant="primary" busy={busy} disabled={!preview?.garments.length || !!missing} onClick={doImport}>
              Import {preview?.garments.length ?? 0} garments
            </Button>
          </>
        )
      }
    >
      {!file || !mapping ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <FileUp className="size-8 text-slate-400" />
          <Button variant="primary" onClick={pick}>
            Choose CSV file
          </Button>
          <p className="max-w-md text-center text-xs text-slate-500">Columns are matched automatically where possible; you can adjust them on the next step. Nothing is saved until you click Import.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            <strong>{file.fileName}</strong>: {file.rows.length} rows
          </p>
          <div className="grid grid-cols-4 gap-3">
            {CSV_FIELDS.map((fld) => (
              <Field key={fld} label={CSV_FIELD_LABELS[fld]}>
                <Select value={mapping[fld] ?? ''} onChange={(e) => setMapping({ ...mapping, [fld]: e.target.value || null })}>
                  <option value="">(not in file)</option>
                  {file.headers.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </Select>
              </Field>
            ))}
            <Field label="Supplier for these garments">
              <Select value={supplier} onChange={(e) => setSupplier(e.target.value as GarmentInput['supplier'])}>
                {SUPPLIERS.map((s) => (
                  <option key={s} value={s}>
                    {SUPPLIER_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="If a brand + style already exists" className="col-span-2">
              <Select value={mode} onChange={(e) => setMode(e.target.value as 'merge' | 'skip')}>
                <option value="merge">Update it: add new colors/sizes, replace costs</option>
                <option value="skip">Leave it unchanged</option>
              </Select>
            </Field>
          </div>
          {missing && <Notice tone="red">Map a Name or Style number column so rows can be grouped into garments.</Notice>}
          {!!preview?.errors.length && (
            <Notice>
              {preview.errors.length} row{preview.errors.length > 1 ? 's' : ''} will be skipped:{' '}
              {preview.errors
                .slice(0, 5)
                .map((er) => `row ${er.row}: ${er.message}`)
                .join('; ')}
              {preview.errors.length > 5 && '…'}
            </Notice>
          )}
          {preview && preview.garments.length > 0 && (
            <Table className="max-h-72 overflow-y-auto">
              <thead>
                <tr>
                  <Th>Brand / style</Th>
                  <Th>Name</Th>
                  <Th>Colors</Th>
                  <Th>Sizes</Th>
                  <Th className="text-right">S–XL</Th>
                  <Th className="text-right">2XL</Th>
                  <Th className="text-right">3XL</Th>
                  <Th className="text-right">4XL+</Th>
                </tr>
              </thead>
              <tbody>
                {preview.garments.slice(0, 50).map((g, i) => (
                  <tr key={i}>
                    <Td>{[g.brand, g.style_number].filter(Boolean).join(' ')}</Td>
                    <Td>{g.name}</Td>
                    <Td>{g.colors.length}</Td>
                    <Td className="text-xs">{g.sizes.join(' ')}</Td>
                    <Td className="text-right tabular">{formatMoney(g.cost_base_cents)}</Td>
                    <Td className="text-right tabular">{formatMoney(g.cost_2xl_cents)}</Td>
                    <Td className="text-right tabular">{formatMoney(g.cost_3xl_cents)}</Td>
                    <Td className="text-right tabular">{formatMoney(g.cost_4xl_plus_cents)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {preview && preview.garments.length > 50 && <p className="text-xs text-slate-500">Showing 50 of {preview.garments.length}.</p>}
        </div>
      )}
    </Dialog>
  )
}
