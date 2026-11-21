import { useQuery } from '@tanstack/react-query'
import { Copy, Mail, Paperclip, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { DocumentKind } from '@shared/ipc'
import { parseEmailList } from '@shared/merge-fields'
import { useToast } from '../../components/toast'
import { Button, Checkbox, Dialog, Field, Input, Loading, Notice, Textarea } from '../../components/ui'
import { api } from '../../lib/api'

/** Compose and send a document by email, or (without SMTP) save the PDF and copy the message. */
export function EmailDialog({ kind, id, open, onOpenChange, onDone, canMarkSent }: { kind: DocumentKind; id: number; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void; canMarkSent: boolean }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['email-compose', kind, id], queryFn: () => api.email.compose(kind, id), enabled: open, gcTime: 0, staleTime: 0 })
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [markSent, setMarkSent] = useState(true)
  const [busy, setBusy] = useState('')
  const toast = useToast()

  useEffect(() => {
    if (data) {
      setTo(data.to)
      setSubject(data.subject)
      setBody(data.body)
      setCc('')
    }
  }, [data])

  const badTo = to && parseEmailList(to).invalid.length > 0
  const input = { kind, id, to, cc, subject, body, mark_sent: canMarkSent && markSent }

  const send = async () => {
    setBusy('send')
    try {
      const r = await api.email.send(input)
      toast.success(`Sent to ${r.to.join(', ')}`)
      onOpenChange(false)
      onDone()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy('')
    }
  }
  const manual = async () => {
    setBusy('manual')
    try {
      await api.email.prepareManual(input)
      toast.success('PDF saved and its folder opened. The message is on your clipboard: paste it into a new email and attach the PDF.')
      onOpenChange(false)
      onDone()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy('')
    }
  }

  const what = kind === 'receipt' ? 'receipt' : kind
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={`Email ${what}`}
      footer={
        data && (
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            {data.smtp_ready ? (
              <>
                <Button icon={<Copy className="size-4" />} busy={busy === 'manual'} onClick={manual} title="Save the PDF and copy the message to send from your own email">
                  Copy instead
                </Button>
                <Button variant="primary" icon={<Send className="size-4" />} busy={busy === 'send'} disabled={!to || !!badTo || !subject.trim()} onClick={send}>
                  Send
                </Button>
              </>
            ) : (
              <Button variant="primary" icon={<Copy className="size-4" />} busy={busy === 'manual'} onClick={manual}>
                Save PDF &amp; copy message
              </Button>
            )}
          </>
        )
      }
    >
      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <Notice tone="red">{String(error)}</Notice>
      ) : (
        <div className="flex flex-col gap-3">
          {!data.smtp_ready && (
            <Notice tone="blue">
              Email isn’t set up, so Inkwell will save the PDF, open its folder and copy this message for you to paste into your own email.{' '}
              <Link to="/settings/email" className="underline" onClick={() => onOpenChange(false)}>
                Set up email
              </Link>
            </Notice>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="To" error={badTo ? 'Check the email addresses' : undefined}>
              <Input list="email-suggestions" value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" invalid={!!badTo} />
            </Field>
            <Field label="Cc (optional)">
              <Input list="email-suggestions" value={cc} onChange={(e) => setCc(e.target.value)} />
            </Field>
            <datalist id="email-suggestions">
              {data.suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <Field label="Subject">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Message">
            <Textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <Paperclip className="size-4" /> {data.attachment_name}
            </span>
            {canMarkSent && <Checkbox checked={markSent} onChange={setMarkSent} label={`Mark the ${what} as sent`} />}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Mail className="size-3.5" /> Edit the default wording under Settings → Email.
          </p>
        </div>
      )}
    </Dialog>
  )
}
