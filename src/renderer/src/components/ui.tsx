import * as RDialog from '@radix-ui/react-dialog'
import * as RSwitch from '@radix-ui/react-switch'
import clsx from 'clsx'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import { forwardRef, useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { bpToPercentString, centsToPlain, parseMoney, parsePercent } from '@shared/money'

export const cx = clsx

// ---------- Button ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 shadow-sm',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-700',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm'
}
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; busy?: boolean; icon?: ReactNode }>(
  function Button({ variant = 'secondary', size = 'md', busy, icon, className, children, disabled, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || busy}
        className={cx(
          'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition disabled:opacity-50 disabled:pointer-events-none',
          size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
          VARIANTS[variant],
          className
        )}
        {...rest}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
        {children}
      </button>
    )
  }
)

// ---------- Inputs ----------
const inputBase =
  'w-full rounded-md border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-xs transition focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent disabled:bg-slate-100 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800'
const border = (invalid?: boolean) => (invalid ? 'border-red-500' : 'border-slate-300 dark:border-slate-600')

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={cx(inputBase, 'h-9', border(invalid), className)} aria-invalid={invalid || undefined} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} className={cx(inputBase, 'py-2 min-h-20', border(invalid), className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(inputBase, 'h-9 pr-8', border(invalid), className)} {...rest}>
      {children}
    </select>
  )
})

/** Label + control + error/hint. Pass the control as children. */
export function Field({ label, error, hint, children, className, htmlFor }: { label: ReactNode; error?: string; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-slate-600 dark:text-slate-300">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : hint ? <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </div>
  )
}

/** Text field bound to a value with label and error. */
export function TextField({ label, value, onChange, error, hint, className, ...rest }: { label: ReactNode; value: string; onChange: (v: string) => void; error?: string; hint?: ReactNode; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const id = useId()
  return (
    <Field label={label} error={error} hint={hint} className={className} htmlFor={id}>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={!!error} {...rest} />
    </Field>
  )
}

/**
 * Text input for a parsed value (money in cents, percent in bp, whole numbers). Keeps what
 * the user typed while focused and only commits a valid value.
 */
function ParsedInput({ value, onChange, parse, format, prefix, suffix, invalid, className, ...rest }: {
  value: number | null
  onChange: (v: number | null) => void
  parse: (s: string) => number | null
  format: (v: number) => string
  prefix?: string
  suffix?: string
  invalid?: boolean
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'prefix'>) {
  const [text, setText] = useState(value == null ? '' : format(value))
  const [focused, setFocused] = useState(false)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    if (!focused) {
      setText(value == null ? '' : format(value))
      setBad(false)
    }
  }, [value, focused, format])
  return (
    <div className={cx('relative', className)}>
      {prefix && <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-slate-400">{prefix}</span>}
      <Input
        inputMode="decimal"
        value={text}
        invalid={invalid || bad}
        className={cx('tabular text-right', prefix && 'pl-6', suffix && 'pr-7')}
        onFocus={(e) => {
          setFocused(true)
          e.target.select()
        }}
        onChange={(e) => {
          setText(e.target.value)
          if (e.target.value.trim() === '') {
            setBad(false)
            onChange(null)
            return
          }
          const v = parse(e.target.value)
          setBad(v === null)
          if (v !== null) onChange(v)
        }}
        onBlur={() => setFocused(false)}
        {...rest}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-slate-400">{suffix}</span>}
    </div>
  )
}

const parseNonNegMoney = (s: string) => {
  const v = parseMoney(s)
  return v === null || v < 0 ? null : v
}
const parseNonNegPercent = (s: string) => {
  const v = parsePercent(s)
  return v === null || v < 0 ? null : v
}
const parseWhole = (s: string) => (/^\s*\d+\s*$/.test(s) ? Number(s.trim()) : null)
const fmtWhole = (v: number) => String(v)

/** Money in cents. Empty input = 0 unless `nullable`. */
export function MoneyInput({ value, onChange, nullable, ...rest }: { value: number | null; onChange: (v: number) => void; nullable?: boolean; invalid?: boolean; className?: string; placeholder?: string; disabled?: boolean; 'aria-label'?: string; id?: string }) {
  return <ParsedInput value={value} onChange={(v) => onChange(v ?? (nullable ? (null as unknown as number) : 0))} parse={parseNonNegMoney} format={centsToPlain} prefix="$" {...rest} />
}

/** Percent stored as basis points. */
export function PercentInput({ value, onChange, ...rest }: { value: number; onChange: (v: number) => void; invalid?: boolean; className?: string; disabled?: boolean; 'aria-label'?: string; id?: string }) {
  return <ParsedInput value={value} onChange={(v) => onChange(v ?? 0)} parse={parseNonNegPercent} format={bpToPercentString} suffix="%" {...rest} />
}

export function IntInput({ value, onChange, ...rest }: { value: number; onChange: (v: number) => void; invalid?: boolean; className?: string; disabled?: boolean; 'aria-label'?: string; id?: string; min?: number }) {
  return <ParsedInput value={value} onChange={(v) => onChange(v ?? 0)} parse={parseWhole} format={fmtWhole} {...rest} />
}

export function MoneyField({ label, error, hint, className, ...rest }: { label: ReactNode; error?: string; hint?: ReactNode; className?: string; value: number; onChange: (v: number) => void }) {
  const id = useId()
  return (
    <Field label={label} error={error} hint={hint} className={className} htmlFor={id}>
      <MoneyInput id={id} invalid={!!error} {...rest} />
    </Field>
  )
}
export function PercentField({ label, error, hint, className, ...rest }: { label: ReactNode; error?: string; hint?: ReactNode; className?: string; value: number; onChange: (v: number) => void }) {
  const id = useId()
  return (
    <Field label={label} error={error} hint={hint} className={className} htmlFor={id}>
      <PercentInput id={id} invalid={!!error} {...rest} />
    </Field>
  )
}
export function IntField({ label, error, hint, className, ...rest }: { label: ReactNode; error?: string; hint?: ReactNode; className?: string; value: number; onChange: (v: number) => void }) {
  const id = useId()
  return (
    <Field label={label} error={error} hint={hint} className={className} htmlFor={id}>
      <IntInput id={id} invalid={!!error} {...rest} />
    </Field>
  )
}

export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-start gap-3">
      <RSwitch.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-slate-300 transition data-[state=checked]:bg-accent disabled:opacity-50 dark:bg-slate-600"
      >
        <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition data-[state=checked]:translate-x-[18px]" />
      </RSwitch.Root>
      <label htmlFor={id} className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
      </label>
    </div>
  )
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; className?: string }) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-sm', className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded border-slate-300 accent-[var(--accent,#2563eb)]" />
      {label}
    </label>
  )
}

// ---------- Layout bits ----------
export function Card({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx('rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  )
}

const BADGE: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300'
}
export function Badge({ color = 'slate', children, className, title }: { color?: keyof typeof BADGE; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', BADGE[color], className)}>
      {children}
    </span>
  )
}

export function SampleBadge() {
  return (
    <Badge color="amber" title="Example values shipped with Inkwell">
      Sample: edit these to match your pricing
    </Badge>
  )
}

export function Notice({ tone = 'amber', children, className }: { tone?: 'amber' | 'red' | 'blue'; children: ReactNode; className?: string }) {
  const tones = {
    amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
    red: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
    blue: 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200'
  }
  return (
    <div className={cx('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', tones[tone], className)}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-6 py-14 text-center dark:border-slate-700">
      {icon && <div className="text-slate-400">{icon}</div>}
      <h3 className="font-medium">{title}</h3>
      {children && <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

// ---------- Table ----------
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900', className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}
export const Th = ({ children, className, onClick, sorted }: { children?: ReactNode; className?: string; onClick?: () => void; sorted?: 'asc' | 'desc' | null }) => (
  <th
    onClick={onClick}
    className={cx(
      'border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400',
      onClick && 'cursor-pointer select-none hover:text-slate-800 dark:hover:text-slate-200',
      className
    )}
  >
    {children}
    {sorted && <span className="ml-1">{sorted === 'asc' ? '↑' : '↓'}</span>}
  </th>
)
export const Td = ({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={cx('border-b border-slate-100 px-3 py-2 align-middle dark:border-slate-800/70', className)}>
    {children}
  </td>
)

// ---------- Dialogs ----------
export function Dialog({ open, onOpenChange, title, description, children, footer, wide }: { open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[1px]" />
        <RDialog.Content
          className={cx(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900',
            wide ? 'max-w-4xl' : 'max-w-lg'
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
            <div>
              <RDialog.Title className="font-semibold">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{String(title)}</RDialog.Description>}
            </div>
            <RDialog.Close className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label="Close">
              <X className="size-4" />
            </RDialog.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

export function ConfirmDialog({ open, onOpenChange, title, children, confirmLabel = 'Confirm', danger, onConfirm }: { open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; children?: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            busy={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
                onOpenChange(false)
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-600 dark:text-slate-300">{children}</div>
    </Dialog>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-slate-400', className)} />
}

export function Loading() {
  return (
    <div className="flex h-40 items-center justify-center">
      <Spinner />
    </div>
  )
}

const parseMultiplier = (s: string) => {
  const m = /^\s*(\d*)(?:\.(\d{0,3}))?\s*$/.exec(s)
  if (!m || (m[1] === '' && !m[2])) return null
  return Number(m[1] || 0) * 1000 + Number((m[2] ?? '').padEnd(3, '0'))
}
const fmtMultiplier = (v: number) => (v / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')

/** A multiplier like ×1.8, stored as an integer × 1000. */
export function MultiplierInput({ value, onChange, ...rest }: { value: number; onChange: (v: number) => void; invalid?: boolean; className?: string; 'aria-label'?: string }) {
  return <ParsedInput value={value} onChange={(v) => onChange(v ?? 0)} parse={parseMultiplier} format={fmtMultiplier} prefix="×" {...rest} />
}
