import { Plus, ShieldCheck, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { formatMoney } from '@shared/money'
import type { CustomerListRow } from '@shared/schemas'
import { Badge, Button, Checkbox, EmptyState, Input, Loading, PageHeader, Select, Table, Td, Th } from '../../components/ui'
import { useCustomers, useTags } from '../../lib/queries'
import { exemptStatus } from './exempt'

type SortKey = 'name' | 'created' | 'balance'

export function CustomersList() {
  const [search, setSearch] = useState('')
  const [exempt, setExempt] = useState<'' | 'yes' | 'no'>('')
  const [tag, setTag] = useState('')
  const [archived, setArchived] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' })
  const navigate = useNavigate()
  const tags = useTags()
  const { data, isLoading } = useCustomers({ search, includeArchived: archived, taxExempt: exempt === '' ? undefined : exempt === 'yes', tag: tag || undefined })

  const rows = useMemo(() => {
    const r = [...(data ?? [])]
    const val = (c: CustomerListRow) => (sort.key === 'name' ? c.display_name.toLowerCase() : sort.key === 'created' ? c.created_at : c.balance_cents)
    r.sort((a, b) => {
      const x = val(a)
      const y = val(b)
      return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir === 'asc' ? 1 : -1)
    })
    return r
  }, [data, sort])

  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))
  const sorted = (key: SortKey) => (sort.key === key ? sort.dir : null)
  const filtering = !!(search || exempt || tag)

  return (
    <>
      <PageHeader
        title="Customers"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/customers/new')}>
            New customer
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder="Search name, email, phone, tag…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
        <Select className="w-44" value={exempt} onChange={(e) => setExempt(e.target.value as typeof exempt)} aria-label="Tax status">
          <option value="">All tax statuses</option>
          <option value="yes">Tax-exempt</option>
          <option value="no">Taxable</option>
        </Select>
        {(tags.data?.length ?? 0) > 0 && (
          <Select className="w-40" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
            <option value="">All tags</option>
            {tags.data!.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        )}
        <Checkbox checked={archived} onChange={setArchived} label="Show archived" />
      </div>
      {isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Users className="size-8" />}
          title={filtering ? 'No customers match' : 'No customers yet'}
          action={!filtering && <Button variant="primary" onClick={() => navigate('/customers/new')}>Add a customer</Button>}
        >
          {filtering ? 'Try a different search or filter.' : 'Customers hold contact details, addresses and tax-exempt certificates.'}
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th onClick={() => sortBy('name')} sorted={sorted('name')}>
                Customer
              </Th>
              <Th>Contact</Th>
              <Th>Tax</Th>
              <Th>Tags</Th>
              <Th className="text-right" onClick={() => sortBy('balance')} sorted={sorted('balance')}>
                Balance
              </Th>
              <Th className="text-right" onClick={() => sortBy('created')} sorted={sorted('created')}>
                Added
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const ex = exemptStatus(c)
              return (
                <tr key={c.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => navigate(`/customers/${c.id}`)}>
                  <Td>
                    <Link to={`/customers/${c.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                      {c.display_name}
                    </Link>
                    {c.archived_at && (
                      <Badge className="ml-2" color="slate">
                        Archived
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-slate-600 dark:text-slate-400">
                    <div>{c.company_name ? [c.first_name, c.last_name].filter(Boolean).join(' ') : ''}</div>
                    <div className="text-xs">{[c.email, c.phone].filter(Boolean).join(' · ')}</div>
                  </Td>
                  <Td>
                    {ex.exempt && (
                      <Badge color={ex.expired ? 'red' : 'green'}>
                        <ShieldCheck className="size-3" />
                        {ex.expired ? 'Cert expired' : 'Exempt'}
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                  </Td>
                  <Td className="text-right tabular">{c.balance_cents ? formatMoney(c.balance_cents) : '–'}</Td>
                  <Td className="text-right text-slate-500 tabular">{new Date(c.created_at).toLocaleDateString()}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </>
  )
}
