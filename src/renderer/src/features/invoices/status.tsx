import { INVOICE_STATUS_LABELS, type InvoiceDisplayStatus } from '@shared/invoice'
import { Badge } from '../../components/ui'

const COLORS: Record<InvoiceDisplayStatus, 'slate' | 'blue' | 'green' | 'red' | 'amber' | 'violet'> = {
  draft: 'slate',
  sent: 'blue',
  partially_paid: 'amber',
  paid: 'green',
  void: 'slate',
  overdue: 'red'
}

export function InvoiceStatusBadge({ status }: { status: InvoiceDisplayStatus }) {
  return <Badge color={COLORS[status]}>{INVOICE_STATUS_LABELS[status]}</Badge>
}
