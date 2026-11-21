import { Calculator, FileText, LayoutDashboard, Receipt, Search, Settings, Shirt, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import type { SearchResult } from '@shared/ipc'
import { cx } from '../components/ui'
import { api, fileUrl } from '../lib/api'
import { useSettings } from '../lib/queries'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/quotes', label: 'Quotes', icon: FileText },
  { to: '/invoices', label: 'Invoices', icon: Receipt },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/catalog', label: 'Catalog', icon: Shirt },
  { to: '/pricing', label: 'Pricing', icon: Calculator },
  { to: '/settings', label: 'Settings', icon: Settings }
]

const isMac = navigator.platform.toLowerCase().includes('mac')

function GlobalSearch() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ref.current?.focus()
        ref.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    let stale = false
    const t = setTimeout(async () => {
      const r = q.trim() ? await api.search.global(q) : []
      if (!stale) {
        setResults(r)
        setActive(0)
      }
    }, 120)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [q])

  const go = (r: SearchResult) => {
    navigate(r.kind === 'customer' ? `/customers/${r.id}` : `/catalog/${r.id}`)
    setQ('')
    setOpen(false)
    ref.current?.blur()
  }

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
      <input
        id="global-search"
        ref={ref}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && results[active]) go(results[active])
          else if (e.key === 'Escape') {
            setQ('')
            ref.current?.blur()
          }
        }}
        placeholder="Search customers, garments…"
        aria-label="Search"
        className="h-8 w-full rounded-md border border-slate-300 bg-white pr-14 pl-8 text-sm focus:border-accent focus:ring-2 focus:ring-accent/40 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-slate-300 px-1.5 text-[10px] text-slate-400 dark:border-slate-600">
        {isMac ? '⌘' : 'Ctrl'} K
      </kbd>
      {open && q.trim() && (
        <div className="absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {results.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-slate-500">No matches</p>
          ) : (
            <ul role="listbox">
              {results.map((r, i) => (
                <li
                  key={`${r.kind}-${r.id}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={() => go(r)}
                  onMouseEnter={() => setActive(i)}
                  className={cx('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm', i === active && 'bg-slate-100 dark:bg-slate-800')}
                >
                  {r.kind === 'customer' ? <Users className="size-4 text-slate-400" /> : <Shirt className="size-4 text-slate-400" />}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.title}</span>
                    {r.subtitle && <span className="block truncate text-xs text-slate-500">{r.subtitle}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export function Layout() {
  const { data: settings } = useSettings()
  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="flex h-14 items-center gap-2.5 border-b border-slate-200 px-4 dark:border-slate-800">
          {settings?.logo_path ? (
            <img src={fileUrl(settings.logo_path)} alt="" className="size-7 rounded object-contain" />
          ) : (
            <div className="flex size-7 items-center justify-center rounded bg-accent text-sm font-bold text-accent-fg">{(settings?.shop_name || 'I')[0]}</div>
          )}
          <span className="truncate text-sm font-semibold">{settings?.shop_name || 'Inkwell'}</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition',
                  isActive
                    ? 'bg-accent/10 text-accent dark:bg-accent/20'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <p className="px-4 py-3 text-[11px] text-slate-400">Inkwell · works offline</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-slate-200 bg-white/80 px-6 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
          <GlobalSearch />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
