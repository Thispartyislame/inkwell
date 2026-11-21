import { Construction } from 'lucide-react'
import { EmptyState, PageHeader } from '../../components/ui'

export function ComingSoon({ what, phase }: { what: string; phase: number }) {
  return (
    <>
      <PageHeader title={what} />
      <EmptyState icon={<Construction className="size-8" />} title={`${what} arrive in Phase ${phase}`}>
        This build covers Phase 1: setup, customers, the garment catalog, pricing and settings.
      </EmptyState>
    </>
  )
}
