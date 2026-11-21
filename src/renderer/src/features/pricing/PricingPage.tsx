import * as Tabs from '@radix-ui/react-tabs'
import { useNavigate, useParams } from 'react-router'
import { PageHeader, cx } from '../../components/ui'
import { FeesTab } from './FeesTab'
import { InksTab } from './InksTab'
import { MatricesTab } from './MatricesTab'
import { RulesTab } from './RulesTab'

const TABS = [
  { id: 'matrices', label: 'Price matrices' },
  { id: 'rules', label: 'Pricing rules' },
  { id: 'fees', label: 'Fee presets' },
  { id: 'inks', label: 'Ink library' }
]

export function TabList({ tabs }: { tabs: { id: string; label: string }[] }) {
  return (
    <Tabs.List className="mb-5 flex gap-1 border-b border-slate-200 dark:border-slate-800">
      {tabs.map((t) => (
        <Tabs.Trigger
          key={t.id}
          value={t.id}
          className={cx(
            '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
            'data-[state=active]:border-accent data-[state=active]:text-slate-900 dark:data-[state=active]:text-white'
          )}
        >
          {t.label}
        </Tabs.Trigger>
      ))}
    </Tabs.List>
  )
}

export function PricingPage() {
  const tab = useParams().tab ?? 'matrices'
  const navigate = useNavigate()
  return (
    <>
      <PageHeader title="Pricing" subtitle="How quotes are priced: decoration matrices, garment markup and adders, and reusable fees." />
      <Tabs.Root value={tab} onValueChange={(t) => navigate(`/pricing/${t}`, { replace: true })}>
        <TabList tabs={TABS} />
        <Tabs.Content value="matrices">
          <MatricesTab />
        </Tabs.Content>
        <Tabs.Content value="rules">
          <RulesTab />
        </Tabs.Content>
        <Tabs.Content value="fees">
          <FeesTab />
        </Tabs.Content>
        <Tabs.Content value="inks">
          <InksTab />
        </Tabs.Content>
      </Tabs.Root>
    </>
  )
}
