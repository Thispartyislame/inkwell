import * as RDialog from '@radix-ui/react-dialog'
import { BarChart3, Calculator, DatabaseBackup, Factory, FileText, LayoutDashboard, Package, Plus, Receipt, Search, Settings, Shirt, Users } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { SearchResult } from '@shared/ipc'
import { api } from '../lib/api'
import { useToast } from './toast'
import { cx } from './ui'

interface Item {
  id: string
  label: string
  hint?: string
  icon: ReactNode
  run: () => void
}

/** Ctrl/Cmd+K: jump anywhere, run common actions, or search records. */
export function CommandPalette({ open, onOpenChange, actions }: { open: boolean; onOpenChange: (v: boolean) => void; actions: { newQuote: () => void; newInvoice: () => void } }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const toast = useToast()
  const go = (to: string) => () => navigate(to)

  const commands: Item[] = useMemo(
    () => [
      { id: 'new-quote', label: 'New quote', hint: 'Ctrl+N', icon: <Plus className="size-4" />, run: actions.newQuote },
      { id: 'new-invoice', label: 'New invoice', icon: <Plus className="size-4" />, run: actions.newInvoice },
      { id: 'new-customer', label: 'New customer', icon: <Plus className="size-4" />, run: go('/customers/new') },
      { id: 'new-garment', label: 'New garment', icon: <Plus className="size-4" />, run: go('/catalog/new') },
      { id: 'dashboard', label: 'Go to Dashboard', icon: <LayoutDashboard className="size-4" />, run: go('/') },
      { id: 'quotes', label: 'Go to Quotes', icon: <FileText className="size-4" />, run: go('/quotes') },
      { id: 'invoices', label: 'Go to Invoices', icon: <Receipt className="size-4" />, run: go('/invoices') },
      { id: 'overdue', label: 'Overdue invoices', icon: <Receipt className="size-4" />, run: go('/invoices?status=overdue') },
      { id: 'production', label: 'Production board', icon: <Factory className="size-4" />, run: go('/production') },
      { id: 'garment-order', label: 'Garment order list', icon: <Package className="size-4" />, run: go('/production/garment-order') },
      { id: 'customers', label: 'Go to Customers', icon: <Users className="size-4" />, run: go('/customers') },
      { id: 'catalog', label: 'Go to Catalog', icon: <Shirt className="size-4" />, run: go('/catalog') },
      { id: 'pricing', label: 'Pricing matrices and rules', icon: <Calculator className="size-4" />, run: go('/pricing') },
      { id: 'reports', label: 'Reports', icon: <BarChart3 className="size-4" />, run: go('/reports') },
      { id: 'tax', label: 'Sales tax report', icon: <BarChart3 className="size-4" />, run: go('/reports/tax') },
      { id: 'settings', label: 'Settings', icon: <Settings className="size-4" />, run: go('/settings') },
      {
        id: 'backup',
        label: 'Back up now',
        icon: <DatabaseBackup className="size-4" />,
        run: () =>
          void api.backup
            .now()
            .then(() => toast.success('Backup saved'))
            .catch(toast.error)
      }
    ],
    [actions]
  )

  useEffect(() => {
    if (!open) {
      setQ('')
      setResults([])
    }
  }, [open])
  useEffect(() => {
    let stale = false
    const t = setTimeout(async () => {
      const r = q.trim().length >= 2 ? await api.search.global(q).catch(() => []) : []
      if (!stale) setResults(r)
    }, 100)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [q])
  useEffect(() => setActive(0), [q, results.length])

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const matching = commands.filter((c) => words.every((w) => c.label.toLowerCase().includes(w)))
  const icon = (k: SearchResult['kind']) => (k === 'customer' ? <Users className="size-4" /> : k === 'quote' ? <FileText className="size-4" /> : k === 'invoice' ? <Receipt className="size-4" /> : <Shirt className="size-4" />)
  const path = (r: SearchResult) => (r.kind === 'customer' ? `/customers/${r.id}` : r.kind === 'quote' ? `/quotes/${r.id}` : r.kind === 'invoice' ? `/invoices/${r.id}` : `/catalog/${r.id}`)
  const items: Item[] = [...results.map((r) => ({ id: `${r.kind}-${r.id}`, label: r.title, hint: r.subtitle, icon: icon(r.kind), run: go(path(r)) })), ...matching]

  const pick = (i: Item | undefined) => {
    if (!i) return
    onOpenChange(false)
    i.run()
  }

  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-slate-950/40" />
        <RDialog.Content className="fixed top-[14vh] left-1/2 z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" aria-describedby={undefined}>
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 dark:border-slate-800">
            <Search className="size-4 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search or type a command…"
              aria-label="Command"
              className="h-12 flex-1 bg-transparent text-sm outline-none"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActive((a) => Math.min(a + 1, items.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((a) => Math.max(a - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  pick(items[active])
                }
              }}
            />
          </div>
          <ul role="listbox" className="max-h-96 overflow-y-auto p-1.5">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No matches</li>}
            {items.map((i, n) => (
              <li
                key={i.id}
                role="option"
                aria-selected={n === active}
                onMouseEnter={() => setActive(n)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(i)
                }}
                className={cx('flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm', n === active && 'bg-slate-100 dark:bg-slate-800')}
              >
                <span className="text-slate-400">{i.icon}</span>
                <span className="min-w-0 flex-1 truncate">
                  {i.label}
                  {i.hint && <span className="ml-2 text-xs text-slate-500">{i.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}
