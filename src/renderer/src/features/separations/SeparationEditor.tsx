import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Eye, EyeOff, FileDown, FileImage, Files, GripVertical, Link2, Loader2, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { todayIso } from '@shared/dates'
import { bpToPercentString } from '@shared/money'
import { isNearWhite } from '@shared/separations/color'
import { filmLayout, filmPages, pageSizeIn } from '@shared/separations/film'
import type { SeparationJob } from '@shared/separations/job'
import { autoMerge, buildPlates, defaultSettings, detectColors, resolveKey, withGarment, type PlateResult } from '@shared/separations/plates'
import type { DetectedColor, FilmOptions, SeparationSettings } from '@shared/separations/types'
import { useToast } from '../../components/toast'
import { Badge, Button, Card, Checkbox, cx, EmptyState, Field, Input, Loading, Notice, Select, Switch, TextField } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useInks } from '../../lib/queries'
import { loadArt, MAX_PNG_PIXELS, MAX_PNG_SIDE, sourceToSvg, svgToPng, type LoadedArt } from './artLoader'
import { LinkDialog } from './LinkDialog'

const GARMENTS = [
  ['White', '#ffffff'],
  ['Black', '#111111'],
  ['Navy', '#1f2a44'],
  ['Heather grey', '#b2b4b2'],
  ['Red', '#c8102e'],
  ['Royal', '#2a4ea6']
] as const

type Mode = 'original' | 'composite' | 'film'

export function SeparationEditorPage() {
  const id = Number(useParams().id)
  const job = useQuery({ queryKey: ['separation', id], queryFn: () => api.separations.get(id), staleTime: Infinity, gcTime: 0, refetchOnMount: 'always' })
  const source = useQuery({ queryKey: ['separation-source', id], queryFn: () => api.separations.source(id), staleTime: Infinity, gcTime: 0, retry: false })
  const inks = useInks()
  const [loaded, setLoaded] = useState<{ art?: LoadedArt; error?: string } | null>(null)
  useEffect(() => {
    if (!source.data || !job.data) return
    let cancelled = false
    ;(async () => {
      try {
        const s = await sourceToSvg(source.data)
        if (!cancelled) setLoaded({ art: loadArt(s.svg, job.data.settings?.art_width_pt, s.warnings, s.note) })
      } catch (e) {
        if (!cancelled) setLoaded({ error: errorMessage(e) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [source.data, job.data])
  // wait for the ink library too, so new separations get matched to your inks
  if (job.isLoading || source.isLoading || inks.isLoading || (!loaded && !source.error)) return <Loading />
  if (job.error || !job.data) return <EmptyState title="Separation not found">{job.error ? errorMessage(job.error) : ''}</EmptyState>
  if (source.error || loaded?.error)
    return (
      <EmptyState title="Couldn’t open this artwork" action={<Link to="/separations" className="text-sm underline">Back to separations</Link>}>
        {source.error ? errorMessage(source.error) : loaded?.error}
      </EmptyState>
    )
  return <Editor key={id} job={job.data} loaded={loaded!.art!} />
}

function Editor({ job: initialJob, loaded: initialLoaded }: { job: SeparationJob; loaded: LoadedArt }) {
  const inks = useInks()
  const toast = useToast()
  const qc = useQueryClient()
  const [job, setJob] = useState(initialJob)
  const [loaded, setLoaded] = useState(initialLoaded)
  const colors: DetectedColor[] = useMemo(() => detectColors(loaded.art), [loaded])
  const [s, setS] = useState<SeparationSettings>(() => job.settings ?? defaultSettings(loaded.art, colors, '#ffffff', inks.data ?? []))
  const [name, setName] = useState(job.name)
  const [tolerance, setTolerance] = useState(8)
  const [mode, setMode] = useState<Mode>('composite')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [filmIndex, setFilmIndex] = useState(0)
  const [result, setResult] = useState<PlateResult | null>(null)
  const [busy, setBusy] = useState('')
  const [linking, setLinking] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const firstSave = useRef(true)

  // Rebuild plates when settings change (debounced: booleans on complex art take a moment).
  useEffect(() => {
    setResult(null)
    const t = setTimeout(() => {
      try {
        setResult(buildPlates(loaded.art, s))
      } catch (e) {
        setResult({ plates: [], warnings: [`Couldn’t build the separations: ${errorMessage(e)}`] })
      }
    }, 200)
    return () => clearTimeout(t)
  }, [loaded, s])

  // Autosave the settings and results.
  useEffect(() => {
    if (!result) return
    if (firstSave.current && job.settings) {
      firstSave.current = false
      return
    }
    firstSave.current = false
    const t = setTimeout(async () => {
      try {
        const inkPlates = result.plates.filter((p) => p.kind !== 'underbase')
        setJob(await api.separations.save(job.id, { name, settings: s, detected_colors: colors, plate_count: result.plates.length, ink_count: inkPlates.length, has_underbase: result.plates.some((p) => p.kind === 'underbase') }))
      } catch (e) {
        toast.error(e)
      }
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, name])

  // Changing the print width re-reads the art at that size.
  const setWidth = (inches: number) => {
    if (!(inches > 0.25 && inches < 60)) return
    const pt = Math.round(inches * 72 * 100) / 100
    setLoaded(loadArt(loaded.svg, pt, loaded.warnings.filter((w) => !loaded.art.warnings.includes(w)), loaded.note))
    setS((x) => ({ ...x, art_width_pt: pt }))
  }

  const set = <K extends keyof SeparationSettings>(k: K, v: SeparationSettings[K]) => setS((x) => ({ ...x, [k]: v }))
  const setFilm = (patch: Partial<FilmOptions>) => setS((x) => ({ ...x, film: { ...x.film, ...patch } }))
  const finalKeys = colors.filter((c) => !s.merge[c.key]).map((c) => c.key)
  const printed = finalKeys.filter((k) => !s.dropped.includes(k))
  const order = [...s.order.filter((k) => printed.includes(k)), ...printed.filter((k) => !s.order.includes(k))]
  const moveOrder = (key: string, to: number) => {
    const next = order.filter((k) => k !== key)
    next.splice(Math.max(0, Math.min(to, next.length)), 0, key)
    set('order', next)
  }
  const colorOf = (key: string) => colors.find((c) => c.key === key)

  const plates = result?.plates ?? []
  const label = { job: s.label.job || name, number: s.label.number || job.owner_number || '', location: s.label.location, date: todayIso() }
  const pages = useMemo(() => (result ? filmPages(result.plates, loaded.art.width_pt, loaded.art.height_pt, s.film, label) : []), [result, loaded, s.film, label.job, label.number, label.location])
  const layout = filmLayout(loaded.art.width_pt, loaded.art.height_pt, s.film)
  const W = loaded.art.width_pt
  const H = loaded.art.height_pt
  const hasTone = colors.some((c) => c.tone !== 'solid')
  const blockers = loaded.warnings.filter((w) => w.code === 'mostly_raster' || w.code === 'empty')

  const compositeSvg = () =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${s.garment_hex}"/>${plates.map((p) => `<path d="${p.d}" fill="${p.kind === 'underbase' ? '#f4f4f4' : p.hex}"/>`).join('')}</svg>`

  const doExport = async (kind: 'pdf' | 'pdfs' | 'png') => {
    if (!pages.length) return
    setBusy(kind)
    try {
      const scale = Math.min(1, 360 / Math.max(W, H))
      const thumbnail = await svgToPng(compositeSvg(), Math.max(1, W * scale), Math.max(1, H * scale), false)
      let pngs: { name: string; base64: string }[] | undefined
      if (kind === 'png') {
        const [wIn, hIn] = pageSizeIn(s.film)
        let dpi = s.film.png_dpi
        const maxDpi = Math.floor(Math.min(MAX_PNG_SIDE / Math.max(wIn, hIn), Math.sqrt(MAX_PNG_PIXELS / (wIn * hIn))))
        if (dpi > maxDpi) {
          toast.success(`PNG resolution lowered to ${maxDpi} dpi for this page size`)
          dpi = maxDpi
        }
        pngs = []
        for (const p of pages) pngs.push({ name: p.name, base64: await svgToPng(p.svg, wIn * dpi, hIn * dpi, true) })
      }
      const r = await api.separations.exportFilms(job.id, { pages, mode: kind, pngs, thumbnail })
      setJob(r.job)
      if (r.path) toast.success(kind === 'pdf' ? `Films saved: ${r.path.split(/[\\/]/).pop()}` : `Saved to ${r.path}`)
      void qc.invalidateQueries({ queryKey: ['board'] })
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy('')
    }
  }

  const film = pages[Math.min(filmIndex, pages.length - 1)]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/separations" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-3" /> Separations
          </Link>
          <div className="flex items-center gap-2">
            <Input className="h-9 w-80 text-lg font-semibold" value={name} onChange={(e) => setName(e.target.value)} aria-label="Separation name" />
            {job.owner_number && (
              <Link to={`/${job.owner_type === 'quote' ? 'quotes' : 'invoices'}/${job.owner_id}`}>
                <Badge color="blue">
                  <Link2 className="size-3" /> {job.owner_number}
                </Badge>
              </Link>
            )}
            {!result && <Loader2 className="size-4 animate-spin text-slate-400" aria-label="Updating" />}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {job.source_name} · {(W / 72).toFixed(2)}″ × {(H / 72).toFixed(2)}″ · {plates.length} screen{plates.length === 1 ? '' : 's'}
            {loaded.note && ` · ${loaded.note}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Link2 className="size-4" />} onClick={() => setLinking(true)} disabled={!plates.length}>
            Link to imprint…
          </Button>
          <Button icon={<FileImage className="size-4" />} busy={busy === 'png'} disabled={!plates.length} onClick={() => doExport('png')}>
            PNGs
          </Button>
          <Button icon={<Files className="size-4" />} busy={busy === 'pdfs'} disabled={!plates.length} onClick={() => doExport('pdfs')}>
            PDF per screen
          </Button>
          <Button variant="primary" icon={<FileDown className="size-4" />} busy={busy === 'pdf'} disabled={!plates.length} onClick={() => doExport('pdf')}>
            Save films PDF
          </Button>
        </div>
      </div>

      {blockers.map((w) => (
        <Notice key={w.code} tone="red">
          {w.message}
        </Notice>
      ))}

      <div className="grid grid-cols-[minmax(0,1fr)_25rem] items-start gap-4">
        {/* preview */}
        <div className="sticky top-0 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            {(['original', 'composite', 'film'] as Mode[]).map((m) => (
              <Button key={m} size="sm" variant={mode === m ? 'primary' : 'secondary'} onClick={() => setMode(m)}>
                {m === 'original' ? 'Original art' : m === 'composite' ? 'Composite' : 'Film view'}
              </Button>
            ))}
            <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
              Garment
              {GARMENTS.map(([n, hex]) => (
                <button key={hex} type="button" title={n} aria-label={`Garment ${n}`} onClick={() => setS((x) => withGarment(x, colors, hex))} className={cx('size-5 rounded-full border border-slate-300', s.garment_hex === hex && 'ring-2 ring-accent ring-offset-1')} style={{ background: hex }} />
              ))}
              <input type="color" value={s.garment_hex} onChange={(e) => setS((x) => withGarment(x, colors, e.target.value))} className="size-6 rounded border border-slate-300" aria-label="Garment color" />
            </span>
          </div>
          <div
            className="flex min-h-[28rem] items-center justify-center rounded-lg border border-slate-200 p-6 dark:border-slate-800"
            style={mode === 'original' ? { backgroundColor: s.garment_hex === '#ffffff' ? undefined : s.garment_hex, backgroundImage: s.garment_hex === '#ffffff' ? 'repeating-conic-gradient(#e2e8f0 0% 25%, #fff 0% 50%)' : undefined, backgroundSize: '16px 16px' } : { background: mode === 'film' ? '#e2e8f0' : s.garment_hex }}
          >
            {mode === 'original' && <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(loaded.svg)}`} alt="Original artwork" className="max-h-[32rem] max-w-full object-contain" />}
            {mode === 'composite' && (
              <svg viewBox={`0 0 ${W} ${H}`} className="max-h-[32rem] w-full" aria-label="Composite preview">
                {plates
                  .filter((p) => !hidden.has(p.key))
                  .map((p) => (
                    <path key={p.key} d={p.d} fill={p.kind === 'underbase' ? '#f4f4f4' : p.hex} />
                  ))}
              </svg>
            )}
            {mode === 'film' && film && <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(film.svg)}`} alt={`Film ${film.name}`} className="max-h-[34rem] max-w-full bg-white shadow" />}
          </div>
          <ul className="flex flex-wrap gap-2" aria-label="Screens">
            {plates.map((p, i) => (
              <li key={p.key}>
                <button
                  type="button"
                  onClick={() => (mode === 'film' ? setFilmIndex(i) : setHidden((h) => (h.has(p.key) ? new Set([...h].filter((x) => x !== p.key)) : new Set([...h, p.key]))))}
                  className={cx('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', mode === 'film' && i === filmIndex ? 'border-accent bg-accent/10' : 'border-slate-300 dark:border-slate-600', mode !== 'film' && hidden.has(p.key) && 'opacity-40')}
                >
                  <span className="size-3 rounded-full border border-slate-300" style={{ background: p.kind === 'underbase' ? '#f4f4f4' : p.hex }} />
                  {i + 1}. {p.name}
                  {p.halftone && <Badge color="violet">halftone</Badge>}
                  {mode !== 'film' && (hidden.has(p.key) ? <EyeOff className="size-3" /> : <Eye className="size-3" />)}
                </button>
              </li>
            ))}
          </ul>
          {[...loaded.warnings.filter((w) => !blockers.includes(w)).map((w) => w.message), ...(result?.warnings ?? []), ...layout.warnings].map((w, i) => (
            <Notice key={i}>{w}</Notice>
          ))}
        </div>

        {/* controls */}
        <div className="flex flex-col gap-4">
          <Card title="Size">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Print width (inches)" hint={`Height ${(H / 72).toFixed(2)}″ · from the file: ${(loaded.art.natural_width_pt / 72).toFixed(2)}″`}>
                <Input type="number" step="0.01" min="0.25" defaultValue={(W / 72).toFixed(2)} onBlur={(e) => setWidth(Number(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && setWidth(Number((e.target as HTMLInputElement).value))} />
              </Field>
            </div>
          </Card>

          <Card
            title={`Colors (${colors.length} found)`}
            actions={
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                ΔE
                <input type="range" min={1} max={30} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} aria-label="Merge tolerance" className="w-20" />
                {tolerance}
                <Button size="sm" icon={<Wand2 className="size-3.5" />} onClick={() => set('merge', autoMerge(colors, tolerance))}>
                  Merge similar
                </Button>
              </span>
            }
            bodyClassName="p-0"
          >
            <ul className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
              {colors.map((c) => {
                const mergedInto = s.merge[c.key]
                const dropped = s.dropped.includes(c.key)
                return (
                  <li key={c.key} className={cx('flex flex-col gap-1.5 px-3 py-2', (mergedInto || dropped) && 'bg-slate-50 dark:bg-slate-900/60')}>
                    <div className="flex items-center gap-2">
                      <span className="size-5 shrink-0 rounded border border-slate-300" style={{ background: c.hex }} />
                      <span className="font-mono">{c.hex}</span>
                      {c.tone !== 'solid' && <Badge color="violet">{c.tone}</Badge>}
                      <span className="ml-auto text-slate-500 tabular">{bpToPercentString(c.coverage_bp)}%</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select className="h-7 w-36 text-xs" value={mergedInto ?? ''} aria-label={`Merge ${c.hex} into`} onChange={(e) => set('merge', Object.fromEntries(Object.entries({ ...s.merge, [c.key]: e.target.value }).filter(([, v]) => v)))}>
                        <option value="">Own screen</option>
                        {colors
                          .filter((o) => o.key !== c.key && resolveKey(o.key, s.merge) !== c.key)
                          .map((o) => (
                            <option key={o.key} value={o.key}>
                              Merge into {o.hex}
                            </option>
                          ))}
                      </Select>
                      {!mergedInto && (
                        <>
                          <Checkbox className="text-xs" checked={dropped} label="Don’t print" onChange={(v) => set('dropped', v ? [...s.dropped, c.key] : s.dropped.filter((x) => x !== c.key))} />
                          {!dropped && (
                            <>
                              <Select
                                className="h-7 w-40 text-xs"
                                aria-label={`Ink for ${c.hex}`}
                                value={inks.data?.find((i) => i.name === s.inks[c.key]?.name)?.id ?? ''}
                                onChange={(e) => {
                                  const ink = inks.data?.find((i) => String(i.id) === e.target.value)
                                  set('inks', { ...s.inks, [c.key]: ink ? { name: ink.name, pms: ink.pms, hex: ink.hex } : { name: c.hex.toUpperCase(), pms: '', hex: c.hex } })
                                }}
                              >
                                <option value="">{s.inks[c.key]?.name ?? c.hex} (as in art)</option>
                                {(inks.data ?? []).map((i) => (
                                  <option key={i.id} value={i.id}>
                                    {i.name}
                                    {i.pms ? ` · ${i.pms}` : ''}
                                  </option>
                                ))}
                              </Select>
                              <Checkbox className="text-xs" checked={s.overprint.includes(c.key)} label="Overprint" onChange={(v) => set('overprint', v ? [...s.overprint, c.key] : s.overprint.filter((x) => x !== c.key))} />
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>

          <Card title="Print order" bodyClassName="p-0">
            <ol className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {s.underbase.enabled && <li className="flex items-center gap-2 px-3 py-1.5 text-slate-500">1. Underbase white (always first)</li>}
              {order.map((k, i) => {
                const c = colorOf(k)
                const ink = s.inks[k]
                return (
                  <li
                    key={k}
                    draggable
                    onDragStart={() => setDragKey(k)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dragKey && moveOrder(dragKey, i)}
                    className={cx('flex items-center gap-2 px-3 py-1.5', dragKey === k && 'opacity-50')}
                  >
                    <GripVertical className="size-4 cursor-grab text-slate-400" />
                    <span className="w-5 text-xs text-slate-500">{i + 1 + (s.underbase.enabled ? 1 : 0)}.</span>
                    <span className="size-4 rounded-full border border-slate-300" style={{ background: ink?.hex ?? c?.hex }} />
                    <span className="flex-1 truncate">{ink?.name ?? k}</span>
                    {s.underbase.highlight_white && isNearWhite(ink?.hex ?? c?.hex ?? '#000') && <Badge>prints last</Badge>}
                    <Button size="sm" variant="ghost" aria-label={`Move ${ink?.name ?? k} earlier`} disabled={i === 0} onClick={() => moveOrder(k, i - 1)}>
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`Move ${ink?.name ?? k} later`} disabled={i === order.length - 1} onClick={() => moveOrder(k, i + 1)}>
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </li>
                )
              })}
            </ol>
          </Card>

          <Card title="Underbase and trapping">
            <div className="flex flex-col gap-3">
              <Switch checked={s.underbase.enabled} onChange={(v) => set('underbase', { ...s.underbase, enabled: v })} label="White underbase" hint="For dark garments: white under all colors, choked so it doesn’t show at the edges." />
              {s.underbase.enabled && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Choke (pt)">
                      <Input type="number" step="0.25" min="0" max="5" value={s.underbase.choke_pt} onChange={(e) => set('underbase', { ...s.underbase, choke_pt: Math.max(0, Number(e.target.value) || 0) })} />
                    </Field>
                    <div className="flex items-end pb-1">
                      <Switch checked={s.underbase.highlight_white} onChange={(v) => set('underbase', { ...s.underbase, highlight_white: v })} label="Highlight white last" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span className="text-slate-500">Leave out of underbase:</span>
                    {order.map((k) => (
                      <Checkbox key={k} className="text-xs" checked={s.underbase.exclude.includes(k)} label={s.inks[k]?.name ?? k} onChange={(v) => set('underbase', { ...s.underbase, exclude: v ? [...s.underbase.exclude, k] : s.underbase.exclude.filter((x) => x !== k) })} />
                    ))}
                  </div>
                </>
              )}
              <Field label="Trap: spread colors printed after the first (pt)" hint="0.5–1 pt hides small registration shifts. 0 = no trap.">
                <Input type="number" step="0.25" min="0" max="5" value={s.trap_pt} onChange={(e) => set('trap_pt', Math.max(0, Number(e.target.value) || 0))} />
              </Field>
            </div>
          </Card>

          {hasTone && (
            <Card title="Halftones" actions={<Badge color="amber">Beta</Badge>}>
              <div className="grid grid-cols-3 gap-3">
                <Field label="LPI">
                  <Input type="number" min="20" max="85" value={s.halftone.lpi} onChange={(e) => set('halftone', { ...s.halftone, lpi: Math.max(20, Math.min(85, Number(e.target.value) || 50)) })} />
                </Field>
                <Field label="Angle (°)">
                  <Input type="number" step="0.5" value={s.halftone.angle} onChange={(e) => set('halftone', { ...s.halftone, angle: Number(e.target.value) || 0 })} />
                </Field>
                <Field label="Dot">
                  <Select value={s.halftone.shape} onChange={(e) => set('halftone', { ...s.halftone, shape: e.target.value as 'round' | 'ellipse' })}>
                    <option value="round">Round</option>
                    <option value="ellipse">Elliptical</option>
                  </Select>
                </Field>
              </div>
            </Card>
          )}

          <Card title="Film">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Page">
                <Select value={s.film.page} onChange={(e) => setFilm({ page: e.target.value as FilmOptions['page'] })}>
                  <option value="letter">Letter 8.5 × 11″</option>
                  <option value="tabloid">Tabloid 11 × 17″</option>
                  <option value="13x19">13 × 19″</option>
                  <option value="custom">Custom…</option>
                </Select>
              </Field>
              {s.film.page === 'custom' ? (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="W″">
                    <Input type="number" step="0.25" value={s.film.custom_w_in} onChange={(e) => setFilm({ custom_w_in: Math.max(1, Number(e.target.value) || 1) })} />
                  </Field>
                  <Field label="H″">
                    <Input type="number" step="0.25" value={s.film.custom_h_in} onChange={(e) => setFilm({ custom_h_in: Math.max(1, Number(e.target.value) || 1) })} />
                  </Field>
                </div>
              ) : (
                <span />
              )}
              <Checkbox checked={s.film.mirror} onChange={(v) => setFilm({ mirror: v })} label="Mirror (emulsion side)" />
              <Checkbox checked={s.film.invert} onChange={(v) => setFilm({ invert: v })} label="Invert (negative)" />
              <Checkbox checked={s.film.registration} onChange={(v) => setFilm({ registration: v })} label="Registration marks" />
              <Checkbox checked={s.film.center_marks} onChange={(v) => setFilm({ center_marks: v })} label="Center marks" />
              <Checkbox checked={s.film.fill_bar} onChange={(v) => setFilm({ fill_bar: v })} label="Fill bar" />
              <Checkbox checked={s.film.label} onChange={(v) => setFilm({ label: v })} label="Label" />
              {s.film.label && (
                <>
                  <TextField label="Job" value={s.label.job} placeholder={name} onChange={(v) => set('label', { ...s.label, job: v })} />
                  <TextField label="Quote / invoice #" value={s.label.number} placeholder={job.owner_number ?? ''} onChange={(v) => set('label', { ...s.label, number: v })} />
                  <TextField label="Location" value={s.label.location} placeholder="Front" onChange={(v) => set('label', { ...s.label, location: v })} />
                </>
              )}
              <Field label="PNG resolution (dpi)">
                <Input type="number" step="60" min="150" max="2400" value={s.film.png_dpi} onChange={(e) => setFilm({ png_dpi: Math.max(150, Number(e.target.value) || 720) })} />
              </Field>
              <Field label="Max print area (in)">
                <div className="flex items-center gap-1">
                  <Input type="number" value={s.film.max_print_w_in} onChange={(e) => setFilm({ max_print_w_in: Number(e.target.value) || 14 })} aria-label="Max print width" />×
                  <Input type="number" value={s.film.max_print_h_in} onChange={(e) => setFilm({ max_print_h_in: Number(e.target.value) || 16 })} aria-label="Max print height" />
                </div>
              </Field>
            </div>
            {layout.warnings.length > 0 && (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {layout.warnings[0]}
              </p>
            )}
          </Card>
        </div>
      </div>
      {linking && (
        <LinkDialog
          job={job}
          onClose={() => setLinking(false)}
          onLinked={(j) => {
            setJob(j)
            setLinking(false)
            toast.success(`Linked: the imprint now has ${j.ink_count} color${j.ink_count === 1 ? '' : 's'}${j.has_underbase ? ' + underbase' : ''}`)
          }}
        />
      )}
    </div>
  )
}
