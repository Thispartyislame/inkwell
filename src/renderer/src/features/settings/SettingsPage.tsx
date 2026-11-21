import * as Tabs from '@radix-ui/react-tabs'
import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Lock, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { formatDocNumber } from '@shared/numbering'
import { PAYMENT_TERMS, PAYMENT_TERMS_LABELS, SettingsSchema, type Settings, type SettingsInput } from '@shared/schemas'
import { useAsync } from '../../components/toast'
import { Button, Card, Field, Input, IntField, Loading, MoneyField, Notice, PageHeader, PercentField, Select, Switch, Textarea, TextField } from '../../components/ui'
import { api, fileUrl } from '../../lib/api'
import { useForm } from '../../lib/form'
import { useSettings } from '../../lib/queries'
import { TabList } from '../pricing/PricingPage'
import { AboutTab } from './AboutTab'
import { BackupsTab } from './BackupsTab'

const TABS = [
  { id: 'shop', label: 'Shop' },
  { id: 'documents', label: 'Quotes & invoices' },
  { id: 'pricing', label: 'Pricing options' },
  { id: 'email', label: 'Email' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'backups', label: 'Backups' },
  { id: 'about', label: 'About' }
]
const FORM_TABS = new Set(['shop', 'documents', 'pricing', 'email', 'appearance'])

const editable = (s: Settings): SettingsInput => Object.fromEntries(Object.keys(SettingsSchema.shape).map((k) => [k, s[k as keyof Settings]])) as SettingsInput

/** Which tab a field lives on, to jump to the first error. */
const FIELD_TAB: Record<string, string> = {
  quote_next_number: 'documents',
  invoice_next_number: 'documents',
  receipt_next_number: 'documents',
  email: 'shop',
  accent_color: 'appearance',
  smtp_port: 'email'
}

export function SettingsPage() {
  const { data } = useSettings()
  if (!data) return <Loading />
  return <SettingsForm key={data.updated_at} settings={data} />
}

function SettingsForm({ settings }: { settings: Settings }) {
  const tab = useParams().tab ?? 'shop'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const run = useAsync()
  const f = useForm<SettingsInput>(editable(settings))
  const v = f.values
  const e = f.errors
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')
  const set = <K extends keyof SettingsInput>(k: K) => (x: SettingsInput[K]) => f.set(k, x)
  const t = (k: keyof SettingsInput, label: string, extra: Record<string, unknown> = {}) => <TextField label={label} value={String(v[k] ?? '')} onChange={(x) => f.set(k, x as never)} error={e[k]} {...extra} />

  const save = async () => {
    const data = f.validate(SettingsSchema)
    if (!data) {
      const first = Object.keys(f.errors)[0]
      if (first && FIELD_TAB[first]) navigate(`/settings/${FIELD_TAB[first]}`)
      return
    }
    setBusy(true)
    const saved = await run(() => api.settings.save(data).catch((err) => (f.fail(err), Promise.reject(err))), 'Settings saved')
    setBusy(false)
    if (saved) qc.setQueryData(['settings'], saved)
  }

  const setLogo = async (clear: boolean) => {
    const s = await run(() => (clear ? api.settings.clearLogo() : api.settings.pickLogo()))
    if (s) {
      qc.setQueryData(['settings'], s)
      f.set('logo_path', s.logo_path)
    }
  }

  const savePassword = async (clear: boolean) => {
    const s = await run(() => api.settings.setSmtpPassword(clear ? null : password), clear ? 'Password removed' : 'Password saved securely')
    if (s) {
      setPassword('')
      // keep unsaved edits in the form: update only the password flag in the cache
      qc.setQueryData<Settings>(['settings'], (old) => (old ? { ...old, smtp_password_set: s.smtp_password_set } : s))
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        actions={
          FORM_TABS.has(tab) && (
            <Button variant="primary" busy={busy} onClick={save} disabled={!f.dirty}>
              Save changes
            </Button>
          )
        }
      />
      <Tabs.Root value={tab} onValueChange={(x) => navigate(`/settings/${x}`, { replace: true })}>
        <TabList tabs={TABS} />

        <Tabs.Content value="shop">
          <div className="grid grid-cols-2 gap-5">
            <Card title="Shop details">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">{t('shop_name', 'Shop name')}</div>
                {t('phone', 'Phone')}
                {t('email', 'Email', { type: 'email' })}
                <div className="col-span-2">{t('website', 'Website')}</div>
                <div className="col-span-2">{t('tax_id', 'Tax ID / EIN / seller’s permit', { hint: 'Printed on invoices if set' })}</div>
              </div>
            </Card>
            <Card title="Address">
              <div className="grid grid-cols-6 gap-3">
                <div className="col-span-6">{t('address_line1', 'Street address')}</div>
                <div className="col-span-6">{t('address_line2', 'Line 2')}</div>
                <div className="col-span-3">{t('city', 'City')}</div>
                <div className="col-span-1">{t('state', 'State')}</div>
                <div className="col-span-2">{t('postal_code', 'ZIP')}</div>
                <div className="col-span-3">{t('country', 'Country')}</div>
                <div className="col-span-3">{t('currency', 'Currency', { maxLength: 3, hint: 'Three-letter code, e.g. USD' })}</div>
              </div>
            </Card>
            <Card title="Logo">
              <div className="flex items-center gap-4">
                <div className="flex size-24 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800">
                  {settings.logo_path ? <img src={fileUrl(settings.logo_path)} alt="Logo" className="size-full object-contain" /> : <ImagePlus className="size-6 text-slate-400" />}
                </div>
                <div className="flex flex-col gap-2">
                  <Button onClick={() => setLogo(false)}>{settings.logo_path ? 'Change logo' : 'Upload logo'}</Button>
                  {settings.logo_path && (
                    <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setLogo(true)}>
                      Remove
                    </Button>
                  )}
                  <p className="text-xs text-slate-500">PNG, JPG or SVG. Shown top-left on PDFs.</p>
                </div>
              </div>
            </Card>
          </div>
        </Tabs.Content>

        <Tabs.Content value="documents">
          <div className="grid grid-cols-2 gap-5">
            <Card title="Defaults">
              <div className="grid grid-cols-2 gap-3">
                <PercentField label="Sales tax rate" value={v.default_tax_bp} onChange={set('default_tax_bp')} error={e.default_tax_bp} />
                <PercentField label="Deposit required" value={v.default_deposit_bp} onChange={set('default_deposit_bp')} error={e.default_deposit_bp} />
                <IntField label="Quotes expire after (days)" value={v.quote_expiration_days} onChange={set('quote_expiration_days')} />
                <Field label="Payment terms">
                  <Select value={v.payment_terms} onChange={(ev) => f.set('payment_terms', ev.target.value as SettingsInput['payment_terms'])}>
                    {PAYMENT_TERMS.map((x) => (
                      <option key={x} value={x}>
                        {PAYMENT_TERMS_LABELS[x]}
                      </option>
                    ))}
                  </Select>
                </Field>
                {v.payment_terms === 'custom' && <IntField label="Due after (days)" value={v.payment_terms_days} onChange={set('payment_terms_days')} />}
              </div>
            </Card>
            <Card title="Numbering">
              <div className="grid grid-cols-2 gap-3">
                {(['quote', 'invoice', 'receipt'] as const).map((k) => (
                  <div key={k} className="contents">
                    {t(`${k}_prefix`, `${k[0].toUpperCase() + k.slice(1)} prefix`)}
                    <IntField
                      label="Next number"
                      value={v[`${k}_next_number`]}
                      onChange={set(`${k}_next_number`)}
                      error={e[`${k}_next_number`]}
                      hint={`Next: ${formatDocNumber(v[`${k}_prefix`], v[`${k}_next_number`])}${settings[`${k}_last_issued`] ? ` · last used ${settings[`${k}_last_issued`]}` : ''}`}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">Numbers only move forward, so one is never reused.</p>
            </Card>
            <Card title="Terms & conditions" className="col-span-2">
              <Textarea rows={6} value={v.terms_text} onChange={(ev) => f.set('terms_text', ev.target.value)} />
            </Card>
            <Card title="How to pay (printed on invoices)">
              <Textarea rows={4} value={v.how_to_pay_text} onChange={(ev) => f.set('how_to_pay_text', ev.target.value)} placeholder={'Venmo: @yourshop\nChecks payable to Your Shop LLC\nZelle: pay@yourshop.com'} />
            </Card>
            <Card title="PDF footer">
              <Textarea rows={4} value={v.pdf_footer_text} onChange={(ev) => f.set('pdf_footer_text', ev.target.value)} placeholder="Thank you for your business!" />
            </Card>
          </div>
        </Tabs.Content>

        <Tabs.Content value="pricing">
          <div className="grid grid-cols-2 gap-5">
            <Card title="Price rounding">
              <Field label="Round customer unit prices to" hint="Rounds half up. Cleaner per-piece prices like $12.25 instead of $12.17.">
                <Select value={v.rounding_mode} onChange={(ev) => f.set('rounding_mode', ev.target.value as SettingsInput['rounding_mode'])}>
                  <option value="cent">The nearest cent</option>
                  <option value="nickel">The nearest $0.05</option>
                  <option value="quarter">The nearest $0.25</option>
                </Select>
              </Field>
            </Card>
            <Card title="Quantity breaks">
              <Switch
                checked={v.combine_quantities}
                onChange={set('combine_quantities')}
                label="Combine quantities across line items with identical imprints"
                hint="24 black + 24 white shirts with the same print are priced at the 48-piece break."
              />
            </Card>
            <Card title="Profit estimate (internal)">
              <MoneyField label="Ink & labor cost per piece" value={v.ink_labor_cost_per_piece_cents} onChange={set('ink_labor_cost_per_piece_cents')} hint="Subtracted along with garment cost to estimate profit and margin. Never shown to customers." />
            </Card>
          </div>
        </Tabs.Content>

        <Tabs.Content value="email">
          <div className="grid grid-cols-2 gap-5">
            <Card title="Outgoing mail (SMTP)">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">{t('smtp_host', 'Server', { placeholder: 'smtp.gmail.com' })}</div>
                <IntField label="Port" value={v.smtp_port} onChange={set('smtp_port')} error={e.smtp_port} />
                <div className="col-span-2">{t('smtp_user', 'Username', { placeholder: 'you@yourshop.com' })}</div>
                <div className="flex items-end pb-1">
                  <Switch checked={v.smtp_secure} onChange={set('smtp_secure')} label="SSL/TLS" hint="Port 465" />
                </div>
                <div className="col-span-3">{t('smtp_from_name', 'From name', { placeholder: v.shop_name })}</div>
                <Field label="Password" className="col-span-3" hint="Stored encrypted with your operating system’s secure storage. For Gmail, use an app password.">
                  <div className="flex gap-2">
                    <Input type="password" value={password} onChange={(ev) => setPassword(ev.target.value)} placeholder={settings.smtp_password_set ? '•••••••• (saved)' : 'Not set'} autoComplete="new-password" />
                    <Button icon={<Lock className="size-4" />} disabled={!password} onClick={() => savePassword(false)}>
                      Save
                    </Button>
                    {settings.smtp_password_set && (
                      <Button variant="ghost" onClick={() => savePassword(true)}>
                        Clear
                      </Button>
                    )}
                  </div>
                </Field>
              </div>
              <p className="mt-3 text-xs text-slate-500">Sending from inside the app arrives in Phase 3. Without SMTP, Inkwell saves the PDF and copies the message for you to send yourself.</p>
            </Card>
            <Card title="Message templates">
              <div className="flex flex-col gap-3">
                {(['quote', 'invoice', 'receipt'] as const).map((k) => (
                  <div key={k} className="flex flex-col gap-2">
                    {t(`email_${k}_subject`, `${k[0].toUpperCase() + k.slice(1)} email subject`)}
                    <Textarea rows={5} aria-label={`${k} email body`} value={v[`email_${k}_body`]} onChange={(ev) => f.set(`email_${k}_body`, ev.target.value)} />
                  </div>
                ))}
                <p className="text-xs text-slate-500">
                  Merge fields: {'{customer_first_name}'} {'{shop_name}'} {'{quote_number}'} {'{invoice_number}'} {'{total}'} {'{balance_due}'} {'{expiration_date}'} {'{amount}'}
                </p>
              </div>
            </Card>
          </div>
        </Tabs.Content>

        <Tabs.Content value="appearance">
          <div className="grid grid-cols-2 gap-5">
            <Card title="Theme">
              <Select value={v.theme} onChange={(ev) => f.set('theme', ev.target.value as SettingsInput['theme'])} aria-label="Theme">
                <option value="system">Match my computer</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </Card>
            <Card title="Accent color">
              <Field label="Used for buttons here and headings on your PDFs" error={e.accent_color}>
                <div className="flex gap-2">
                  <input type="color" value={/^#[0-9a-f]{6}$/i.test(v.accent_color) ? v.accent_color : '#2563eb'} onChange={(ev) => f.set('accent_color', ev.target.value)} className="h-9 w-12 rounded border border-slate-300" aria-label="Pick accent color" />
                  <Input className="w-32" value={v.accent_color} onChange={(ev) => f.set('accent_color', ev.target.value)} invalid={!!e.accent_color} />
                </div>
              </Field>
            </Card>
            {f.dirty && <Notice tone="blue">Save changes to apply the theme and color.</Notice>}
          </div>
        </Tabs.Content>

        <Tabs.Content value="backups">
          <BackupsTab />
        </Tabs.Content>
        <Tabs.Content value="about">
          <AboutTab />
        </Tabs.Content>
      </Tabs.Root>
    </>
  )
}
