import { useQuery } from '@tanstack/react-query'
import type { CustomerDocument } from '@shared/documents'
import { Dialog, Loading } from '../../components/ui'
import { api } from '../../lib/api'
import { DocumentView } from '../../pdf/DocumentView'
import '../../pdf/document.css'

/** Renders the same template as the PDF, on a white page. Page breaks only appear in the PDF. */
export function PreviewDialog({ quoteId, open, onOpenChange, version }: { quoteId: number; open: boolean; onOpenChange: (v: boolean) => void; version: string }) {
  const { data, isLoading } = useQuery<CustomerDocument>({ queryKey: ['quote-doc', quoteId, version], queryFn: () => api.quotes.document(quoteId), enabled: open })
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Preview" description="Exactly what the customer sees. Costs, margins and internal notes are never included." wide>
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div className="flex justify-center rounded-md bg-slate-200 p-6 dark:bg-slate-950">
          <div className="inkdoc-preview relative bg-white p-[0.5in] shadow-xl" style={{ width: '8.5in', zoom: 0.92 }}>
            <DocumentView doc={data} />
          </div>
        </div>
      )}
    </Dialog>
  )
}
