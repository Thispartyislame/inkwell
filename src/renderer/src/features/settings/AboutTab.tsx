import { FolderOpen } from 'lucide-react'
import { Button, Card, Loading } from '../../components/ui'
import { api } from '../../lib/api'
import { useAppInfo } from '../../lib/queries'

export function AboutTab() {
  const { data } = useAppInfo()
  if (!data) return <Loading />
  return (
    <Card className="max-w-2xl">
      <h2 className="text-lg font-semibold">Inkwell {data.version}</h2>
      <p className="mt-1 text-sm text-slate-500">Quotes and invoices for screen printing shops. Works entirely offline; your data never leaves this computer unless you email a document.</p>
      <dl className="mt-4 grid grid-cols-[10rem_1fr] gap-y-1.5 text-sm">
        <dt className="text-slate-500">Data folder</dt>
        <dd className="font-mono text-xs break-all">{data.userDataPath}</dd>
        <dt className="text-slate-500">Database</dt>
        <dd className="font-mono text-xs break-all">{data.dbPath}</dd>
        <dt className="text-slate-500">Schema version</dt>
        <dd>{data.schemaVersion}</dd>
        <dt className="text-slate-500">Electron</dt>
        <dd>{data.electron}</dd>
        <dt className="text-slate-500">Platform</dt>
        <dd>{data.platform}</dd>
      </dl>
      <Button className="mt-4" icon={<FolderOpen className="size-4" />} onClick={() => api.app.openDataFolder()}>
        Open data folder
      </Button>
      <p className="mt-4 text-xs text-slate-500">Font: Inter (SIL Open Font License). Icons: Lucide (ISC).</p>
    </Card>
  )
}
