import { Factory } from 'lucide-react'
import { PRODUCTION_LABELS, PRODUCTION_STATUSES, type ProductionStatus } from '@shared/production'
import { useAsync } from '../../components/toast'
import { Select } from '../../components/ui'
import { api } from '../../lib/api'
import { useInvalidate } from '../../lib/queries'

/** Production stage picker for a job's page. */
export function ProductionSelect({ kind, id, value, onChanged }: { kind: 'quote' | 'invoice'; id: number; value: ProductionStatus | null; onChanged: () => void }) {
  const run = useAsync()
  const invalidate = useInvalidate()
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-500">
      <Factory className="size-3.5" />
      <Select
        className="h-7 w-44 text-xs"
        aria-label="Production status"
        value={value ?? ''}
        onChange={async (e) => {
          const v = (e.target.value || null) as ProductionStatus | null
          const ok = await run(() => api.production.setStatus({ kind, id }, v), v ? `Production: ${PRODUCTION_LABELS[v]}` : 'Removed from the production board')
          if (ok !== undefined) {
            void invalidate('board', 'dashboard')
            onChanged()
          }
        }}
      >
        <option value="">Not on production board</option>
        {PRODUCTION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {PRODUCTION_LABELS[s]}
          </option>
        ))}
      </Select>
    </label>
  )
}
