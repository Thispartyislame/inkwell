import { FileImage, FolderOpen, Paperclip, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { IMAGE_MIME } from '@shared/files'
import type { Attachment } from '@shared/schemas'
import { useAsync } from '../../components/toast'
import { Button, Card, Checkbox, ConfirmDialog, cx, Input } from '../../components/ui'
import { api, fileUrl } from '../../lib/api'

export function AttachmentsCard({ quoteId, attachments, editable, onChanged }: { quoteId: number; attachments: Attachment[]; editable: boolean; onChanged: () => void }) {
  const run = useAsync()
  const [over, setOver] = useState(false)
  const [deleting, setDeleting] = useState<Attachment | null>(null)

  const add = async (paths: string[] | null) => {
    const r = await run(() => api.quotes.addAttachments(quoteId, paths))
    if (r?.length) onChanged()
  }

  return (
    <Card
      title={`Mockups & artwork${attachments.length ? ` (${attachments.length})` : ''}`}
      actions={
        <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => add(null)}>
          Add files
        </Button>
      }
    >
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const paths = [...e.dataTransfer.files].map((f) => window.files.pathFor(f)).filter(Boolean)
          if (paths.length) void add(paths)
        }}
        className={cx('rounded-md border-2 border-dashed p-3 transition', over ? 'border-accent bg-accent/5' : 'border-slate-200 dark:border-slate-700')}
      >
        {attachments.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-4 text-sm text-slate-500">
            <Paperclip className="size-4" /> Drop mockups or artwork here. Images can appear on the quote PDF.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-3">
            {attachments.map((a) => {
              const image = IMAGE_MIME.test(a.mime)
              return (
                <li key={a.id} className="flex flex-col gap-1.5 rounded-md border border-slate-200 p-2 text-xs dark:border-slate-700">
                  <button type="button" className="flex h-28 items-center justify-center overflow-hidden rounded bg-slate-50 dark:bg-slate-800" onClick={() => run(() => api.app.openAttachment(a.id))} title="Open">
                    {image ? <img src={fileUrl(a.rel_path)} alt={a.caption || a.original_name} className="max-h-full max-w-full object-contain" /> : <FileImage className="size-8 text-slate-400" />}
                  </button>
                  <span className="truncate font-medium" title={a.original_name}>
                    {a.original_name}
                  </span>
                  <Input
                    className="h-7 text-xs"
                    defaultValue={a.caption}
                    placeholder="Caption"
                    aria-label={`Caption for ${a.original_name}`}
                    onBlur={(e) => e.target.value !== a.caption && void run(async () => (await api.quotes.updateAttachment(a.id, { caption: e.target.value }), onChanged()))}
                  />
                  <div className="flex items-center justify-between">
                    {image ? (
                      <Checkbox checked={a.include_in_pdf} label="On PDF" onChange={(v) => run(async () => (await api.quotes.updateAttachment(a.id, { include_in_pdf: v }), onChanged()))} />
                    ) : (
                      <span className="text-slate-500">{a.kind === 'artwork' ? 'Artwork' : a.kind}</span>
                    )}
                    <span className="flex">
                      <Button size="sm" variant="ghost" title="Show in folder" aria-label="Show in folder" onClick={() => run(() => api.app.revealAttachment(a.id))}>
                        <FolderOpen className="size-3.5" />
                      </Button>
                      {editable && (
                        <Button size="sm" variant="ghost" title="Remove" aria-label={`Remove ${a.original_name}`} onClick={() => setDeleting(a)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove file?"
        danger
        confirmLabel="Remove"
        onConfirm={async () => {
          await run(async () => (await api.quotes.deleteAttachment(deleting!.id), onChanged()), 'File removed')
        }}
      >
        {deleting?.original_name} will be deleted from this quote. The original file on your computer is not touched.
      </ConfirmDialog>
    </Card>
  )
}
