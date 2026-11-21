import { ArrowRight, Calculator, CheckCircle2, Circle, DatabaseBackup, Shirt, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Card, PageHeader } from '../../components/ui'
import { useBackups, useCustomers, useGarments, useMatrices, useRules, useSettings } from '../../lib/queries'

function Step({ done, to, children }: { done: boolean; to: string; children: ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
      {done ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-slate-300" />}
      <span className={done ? 'text-slate-500 line-through' : ''}>{children}</span>
      <ArrowRight className="ml-auto size-4 text-slate-300" />
    </Link>
  )
}

function Stat({ icon, label, value, to }: { icon: ReactNode; label: string; value: ReactNode; to: string }) {
  return (
    <Link to={to} className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-accent dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular">{value}</div>
    </Link>
  )
}

export function Dashboard() {
  const { data: s } = useSettings()
  const customers = useCustomers({})
  const garments = useGarments({})
  const matrices = useMatrices()
  const rules = useRules()
  const backups = useBackups()
  const pricingEdited = !!rules.data && (!rules.data.is_sample || (matrices.data ?? []).some((m) => !m.is_sample))
  return (
    <>
      <PageHeader title={`Welcome${s?.shop_name ? `, ${s.shop_name}` : ''}`} subtitle="The full dashboard (open quotes, balances, deadlines) arrives with quotes and invoices." />
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat icon={<Users className="size-4" />} label="Customers" value={customers.data?.length ?? '–'} to="/customers" />
        <Stat icon={<Shirt className="size-4" />} label="Garments in catalog" value={garments.data?.length ?? '–'} to="/catalog" />
        <Stat icon={<DatabaseBackup className="size-4" />} label="Last backup" value={s?.last_backup_at ? new Date(s.last_backup_at).toLocaleDateString() : 'Never'} to="/settings/backups" />
      </div>
      <Card title="Getting started" className="max-w-xl">
        <div className="-mx-2">
          <Step done={!!s?.shop_name} to="/settings">
            Shop details and logo
          </Step>
          <Step done={pricingEdited} to="/pricing">
            Make the sample pricing matrices and rules your own
          </Step>
          <Step done={(garments.data ?? []).some((g) => !g.notes.startsWith('Sample garment'))} to="/catalog">
            Add your garments (or import a supplier CSV)
          </Step>
          <Step done={(customers.data?.length ?? 0) > 0} to="/customers/new">
            Add your first customer
          </Step>
          <Step done={(backups.data?.length ?? 0) > 0} to="/settings/backups">
            Check your backups
          </Step>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <Calculator className="size-3.5" /> Quotes and invoices come in the next phases.
        </p>
      </Card>
    </>
  )
}
