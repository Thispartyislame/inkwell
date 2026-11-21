import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cx, Input } from './ui'

export interface ComboItem<T> {
  key: string
  value: T
  label: string
  sublabel?: string
  icon?: ReactNode
}

/**
 * Searchable picker: type to filter, arrows to move, Enter to pick, Escape to close.
 * `actions` are extra rows at the bottom (e.g. "New customer…").
 */
export function Combobox<T>({
  items,
  value,
  onSelect,
  placeholder,
  filter,
  actions = [],
  autoFocus,
  'aria-label': ariaLabel,
  invalid,
  className
}: {
  items: ComboItem<T>[]
  value: string
  onSelect: (v: T) => void
  placeholder?: string
  filter?: (item: ComboItem<T>, query: string) => boolean
  actions?: { label: string; icon?: ReactNode; onSelect: (query: string) => void }[]
  autoFocus?: boolean
  'aria-label'?: string
  invalid?: boolean
  className?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  const listId = useId()

  const match =
    filter ??
    ((item: ComboItem<T>, q: string) => {
      const hay = `${item.label} ${item.sublabel ?? ''}`.toLowerCase()
      return q
        .toLowerCase()
        .split(/\s+/)
        .every((w) => hay.includes(w))
    })
  const shown = (query.trim() ? items.filter((i) => match(i, query.trim())) : items).slice(0, 50)
  const rows = shown.length + actions.length

  useEffect(() => setActive(0), [query])

  const pick = (i: number) => {
    if (i < shown.length) onSelect(shown[i].value)
    else actions[i - shown.length]?.onSelect(query.trim())
    setQuery('')
    setOpen(false)
    ref.current?.blur()
  }

  return (
    <div className={cx('relative', className)}>
      <Input
        ref={ref}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        invalid={invalid}
        value={open ? query : value}
        placeholder={open ? value || placeholder : placeholder}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, rows - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (rows) pick(active)
          } else if (e.key === 'Escape') {
            setOpen(false)
            ref.current?.blur()
          }
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {shown.length === 0 && !actions.length && <li className="px-3 py-2 text-sm text-slate-500">No matches</li>}
          {shown.map((item, i) => (
            <li
              key={item.key}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(i)
              }}
              onMouseEnter={() => setActive(i)}
              className={cx('flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm', i === active && 'bg-slate-100 dark:bg-slate-800')}
            >
              {item.icon}
              <span className="min-w-0">
                <span className="block truncate">{item.label}</span>
                {item.sublabel && <span className="block truncate text-xs text-slate-500">{item.sublabel}</span>}
              </span>
            </li>
          ))}
          {actions.map((a, j) => {
            const i = shown.length + j
            return (
              <li
                key={a.label}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(i)
                }}
                onMouseEnter={() => setActive(i)}
                className={cx('flex cursor-pointer items-center gap-2 border-t border-slate-100 px-3 py-1.5 text-sm font-medium text-accent dark:border-slate-800', i === active && 'bg-slate-100 dark:bg-slate-800')}
              >
                {a.icon}
                {a.label}
                {query.trim() && <span className="truncate text-slate-500">“{query.trim()}”</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
