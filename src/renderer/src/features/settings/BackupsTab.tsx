import { DatabaseBackup, FolderOpen, History, Upload } from 'lucide-react'
import { useState } from 'react'
import type { BackupInfo } from '@shared/ipc'
import { useAsync } from '../../components/toast'
import { Button, Card, ConfirmDialog, EmptyState, Loading, Table, Td, Th } from '../../components/ui'
import { api } from '../../lib/api'
import { useBackups, useInvalidate, useSettings } from '../../lib/queries'

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

export function BackupsTab() {
  const { data, isLoading } = useBackups()
  const { data: settings } = useSettings()
  const run = useAsync()
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState<BackupInfo | 'pick' | null>(null)

  const backupNow = async () => {
    setBusy(true)
    await run(async () => {
      await api.backup.now()
      await invalidate('backups', 'settings')
    }, 'Backup saved')
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex items-start justify-between gap-6">
          <div className="text-sm">
            <p>
              Inkwell backs up your data automatically once a day and keeps the newest 30 backups. Last backup:{' '}
              <strong>{settings?.last_backup_at ? new Date(settings.last_backup_at).toLocaleString() : 'never'}</strong>.
            </p>
            <p className="mt-1 text-slate-500">Backups stay on this computer. For safety, also copy the backups folder to a USB drive or cloud folder now and then.</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button icon={<FolderOpen className="size-4" />} onClick={() => run(() => api.backup.reveal())}>
              Open folder
            </Button>
            <Button icon={<Upload className="size-4" />} onClick={() => setRestoring('pick')}>
              Restore from file…
            </Button>
            <Button variant="primary" icon={<DatabaseBackup className="size-4" />} busy={busy} onClick={backupNow}>
              Back up now
            </Button>
          </div>
        </div>
      </Card>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState icon={<History className="size-8" />} title="No backups yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Backup</Th>
              <Th>Saved</Th>
              <Th className="text-right">Size</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((b) => (
              <tr key={b.file}>
                <Td className="font-mono text-xs">{b.file}</Td>
                <Td>{new Date(b.created_at).toLocaleString()}</Td>
                <Td className="text-right tabular">{size(b.size_bytes)}</Td>
                <Td className="text-right">
                  <Button size="sm" onClick={() => setRestoring(b)}>
                    Restore
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ConfirmDialog
        open={!!restoring}
        onOpenChange={(o) => !o && setRestoring(null)}
        title="Restore from backup?"
        danger
        confirmLabel={restoring === 'pick' ? 'Choose file and restore' : 'Restore and restart'}
        onConfirm={async () => {
          await run(() => (restoring === 'pick' ? api.backup.pickAndRestore() : api.backup.restore((restoring as BackupInfo).path)))
        }}
      >
        Everything will be replaced with the data in {restoring === 'pick' ? 'the backup you choose' : <strong>{(restoring as BackupInfo | null)?.file}</strong>}. Inkwell first saves a backup of your current data (named “before-restore”), so you can undo this. The app restarts when it’s done.
      </ConfirmDialog>
    </div>
  )
}
