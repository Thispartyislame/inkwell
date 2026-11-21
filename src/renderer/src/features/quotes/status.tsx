import { QUOTE_STATUS_LABELS, type QuoteStatus } from '@shared/quote'
import { Badge } from '../../components/ui'

const COLORS: Record<QuoteStatus, 'slate' | 'blue' | 'green' | 'red' | 'amber' | 'violet'> = {
  draft: 'slate',
  sent: 'blue',
  approved: 'green',
  declined: 'red',
  expired: 'amber',
  superseded: 'slate'
}

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return <Badge color={COLORS[status]}>{QUOTE_STATUS_LABELS[status]}</Badge>
}
