import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router'
import { Loading } from '../components/ui'
import { useInvalidate, useSettings } from '../lib/queries'
import { useTheme } from '../lib/theme'
import { CatalogList } from '../features/catalog/CatalogList'
import { GarmentEditor } from '../features/catalog/GarmentEditor'
import { CustomerDetailPage } from '../features/customers/CustomerDetail'
import { CustomerEditor } from '../features/customers/CustomerEditor'
import { CustomersList } from '../features/customers/CustomersList'
import { Dashboard } from '../features/dashboard/Dashboard'
import { InvoicePage } from '../features/invoices/InvoiceEditor'
import { InvoicesList } from '../features/invoices/InvoicesList'
import { MatrixEditor } from '../features/pricing/MatrixEditor'
import { PricingPage } from '../features/pricing/PricingPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { SetupWizard } from '../features/setup/SetupWizard'
import { Layout } from './Layout'
import { QuoteBuilderPage } from '../features/quotes/QuoteBuilder'
import { QuotesList, useNewQuote } from '../features/quotes/QuotesList'

function MainEvents() {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const newQuote = useNewQuote()
  useEffect(
    () =>
      window.events.on((e) => {
        if (e.type === 'navigate') navigate(e.to)
        if (e.type === 'backup-done') void invalidate('backups', 'settings')
        if (e.type === 'command-palette') document.getElementById('global-search')?.focus()
        if (e.type === 'new-quote') void newQuote()
      }),
    [navigate, invalidate, newQuote]
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        if (!e.repeat) void newQuote()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newQuote])
  return null
}

export function App() {
  const settings = useSettings()
  useTheme(settings.data)
  if (settings.isLoading) return <Loading />
  if (settings.error) return <p className="p-8 text-red-600">Couldn’t load settings: {String(settings.error)}</p>
  if (!settings.data!.setup_completed_at) return <SetupWizard />
  return (
    <HashRouter>
      <MainEvents />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="quotes" element={<QuotesList />} />
          <Route path="quotes/:id" element={<QuoteBuilderPage />} />
          <Route path="invoices" element={<InvoicesList />} />
          <Route path="invoices/:id" element={<InvoicePage />} />
          <Route path="customers" element={<CustomersList />} />
          <Route path="customers/new" element={<CustomerEditor />} />
          <Route path="customers/:id" element={<CustomerDetailPage />} />
          <Route path="customers/:id/edit" element={<CustomerEditor />} />
          <Route path="catalog" element={<CatalogList />} />
          <Route path="catalog/new" element={<GarmentEditor />} />
          <Route path="catalog/:id" element={<GarmentEditor />} />
          <Route path="pricing" element={<PricingPage />} />
          <Route path="pricing/:tab" element={<PricingPage />} />
          <Route path="pricing/matrices/:id" element={<MatrixEditor />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/:tab" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
