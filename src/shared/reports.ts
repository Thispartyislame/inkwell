import type { Cents } from './money'
import type { PaymentMethod } from './invoice'

export interface SalesPeriodRow {
  period: string
  invoices: number
  /** before tax and shipping */
  net_sales_cents: Cents
  tax_cents: Cents
  shipping_cents: Cents
  total_cents: Cents
  /** payments received in the period (by payment date) */
  collected_cents: Cents
}

export interface SalesByCustomerRow {
  customer_id: number | null
  customer: string
  invoices: number
  net_sales_cents: Cents
  tax_cents: Cents
  total_cents: Cents
  paid_cents: Cents
  balance_cents: Cents
}

export interface SalesTaxRow {
  period: string
  invoices: number
  /** net sales + shipping */
  gross_sales_cents: Cents
  taxable_sales_cents: Cents
  /** sales to tax-exempt customers (resale / exemption certificate) */
  exempt_sales_cents: Cents
  /** non-taxable items and fees for taxable customers (e.g. untaxed shipping) */
  nontaxable_sales_cents: Cents
  tax_cents: Cents
}

export interface PaymentsByMethodRow {
  method: PaymentMethod
  label: string
  payments: number
  amount_cents: Cents
}

export interface WinRateReport {
  quotes: number
  draft: number
  open: number
  approved: number
  declined: number
  expired: number
  approved_cents: Cents
  lost_cents: Cents
  open_cents: Cents
  /** approved ÷ (approved + declined + expired), null when nothing is decided yet */
  win_rate_bp: number | null
}

export interface DashboardItem {
  id: number
  number: string
  customer: string
  job_name: string
  total_cents: Cents
  date: string | null
}

export interface DashboardSummary {
  awaiting: { count: number; total_cents: Cents; items: DashboardItem[] }
  expiring: { count: number; total_cents: Cents; items: DashboardItem[] }
  outstanding: { count: number; total_cents: Cents; items: DashboardItem[] }
  overdue: { count: number; total_cents: Cents; items: DashboardItem[] }
  sales: { this_month_cents: Cents; last_month_cents: Cents; collected_this_month_cents: Cents; collected_last_month_cents: Cents }
  in_hands: Array<{ kind: 'quote' | 'invoice'; id: number; number: string; customer: string; job_name: string; in_hands_on: string; production_status: string | null }>
}

export interface ReportRange {
  from: string
  to: string
  by?: 'month' | 'quarter'
}
