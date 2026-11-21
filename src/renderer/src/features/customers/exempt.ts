import type { Customer } from '@shared/schemas'

export const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Tax-exempt status, with an expired certificate called out. */
export function exemptStatus(c: Pick<Customer, 'tax_exempt' | 'exempt_cert_expires_on'>, today = todayIso()) {
  const expired = !!c.tax_exempt && !!c.exempt_cert_expires_on && c.exempt_cert_expires_on < today
  return { exempt: c.tax_exempt, expired }
}
