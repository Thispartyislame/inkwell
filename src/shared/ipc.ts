/**
 * The typed IPC contract. The renderer calls `window.api.<domain>.<method>(...)`; main
 * implements the same interface. Adding a method means adding it to `Api` and to
 * `API_METHODS` (the compiler enforces both sides).
 */
import type {
  ActivityEntry,
  Attachment,
  Contact,
  ContactInput,
  Customer,
  CustomerInput,
  CustomerListRow,
  FeePreset,
  FeePresetInput,
  Garment,
  GarmentInput,
  Ink,
  InkInput,
  PricingMatrix,
  PricingMatrixInput,
  PricingRules,
  PricingRulesInput,
  Settings,
  SettingsInput
} from './schemas'
import type { CustomerDocument } from './documents'
export type { ReportRange } from './reports'
import type { DashboardSummary, PaymentsByMethodRow, ReportRange, SalesByCustomerRow, SalesPeriodRow, SalesTaxRow, WinRateReport } from './reports'
import type { BoardJob, GarmentOrder, JobRef, ProductionStatus } from './production'
import type { PricingBase, QuoteDetail, QuoteEdit, QuoteListRow, QuoteRecord, QuoteStatus } from './quote'
import type { InvoiceDetail, InvoiceEdit, InvoiceListRow, InvoiceRecord, InvoiceStatus, Payment, PaymentInput } from './invoice'

export interface AppInfo {
  version: string
  electron: string
  userDataPath: string
  dbPath: string
  schemaVersion: number
  platform: string
}

export interface BackupInfo {
  file: string
  path: string
  size_bytes: number
  created_at: string
}

export interface CustomerFilter {
  search?: string
  includeArchived?: boolean
  taxExempt?: boolean
  tag?: string
}

export interface CustomerDetail {
  customer: Customer
  contacts: Contact[]
  certAttachment: Attachment | null
  /** filled in by Phase 2/3; empty until then */
  quotes: Array<{ id: number; number: string; job_name: string; status: string; total_cents: number; issued_on: string }>
  invoices: Array<{ id: number; number: string; job_name: string; status: string; total_cents: number; balance_cents: number; issued_on: string; due_on: string | null }>
  payments: import('./invoice').Payment[]
  balance_cents: number
  activity: ActivityEntry[]
}

export interface GarmentFilter {
  search?: string
  includeArchived?: boolean
  category?: string
  activeOnly?: boolean
}

export interface ImportResult {
  created: number
  updated: number
  skipped: number
}

export interface SearchResult {
  kind: 'customer' | 'garment' | 'quote' | 'invoice'
  id: number
  title: string
  subtitle: string
}

export interface QuoteFilter {
  status?: QuoteStatus | 'open'
  customer_id?: number
  from?: string
  to?: string
  search?: string
  includeArchived?: boolean
  includeSuperseded?: boolean
}

export type DocumentKind = 'quote' | 'invoice' | 'receipt'

export interface InvoiceFilter {
  status?: InvoiceStatus | 'overdue' | 'unpaid'
  customer_id?: number
  from?: string
  to?: string
  search?: string
  includeArchived?: boolean
  today?: string
}

export interface EmailCompose {
  to: string
  /** customer and contact addresses */
  suggestions: string[]
  subject: string
  body: string
  attachment_name: string
  smtp_ready: boolean
}

export interface EmailSendInput {
  kind: DocumentKind
  id: number
  to: string
  cc?: string
  subject: string
  body: string
  /** a draft quote or invoice becomes Sent */
  mark_sent: boolean
}

export interface AttachmentPatch {
  caption?: string
  include_in_pdf?: boolean
  kind?: Attachment['kind']
}

export interface SetupInput {
  shop_name: string
  address_line1: string
  address_line2: string
  city: string
  state: string
  postal_code: string
  phone: string
  email: string
  website: string
  default_tax_bp: number
  quote_prefix: string
  quote_next_number: number
  invoice_prefix: string
  invoice_next_number: number
  payment_terms: Settings['payment_terms']
  payment_terms_days: number
  default_deposit_bp: number
  quote_expiration_days: number
  terms_text: string
}

export interface Api {
  app: {
    info(): AppInfo
    openDataFolder(): void
    openAttachment(id: number): void
    revealAttachment(id: number): void
  }
  settings: {
    get(): Settings
    save(input: SettingsInput): Settings
    completeSetup(input: SetupInput): Settings
    pickLogo(): Settings | null
    clearLogo(): Settings
    setSmtpPassword(password: string | null): Settings
    encryptionAvailable(): boolean
  }
  customers: {
    list(filter: CustomerFilter): CustomerListRow[]
    get(id: number): CustomerDetail
    save(input: CustomerInput): Customer
    archive(id: number): Customer
    restore(id: number): Customer
    tags(): string[]
    saveContact(input: ContactInput): Contact
    deleteContact(id: number): void
    attachCert(customerId: number): Customer | null
    removeCert(customerId: number): Customer
  }
  garments: {
    list(filter: GarmentFilter): Garment[]
    get(id: number): Garment
    save(input: GarmentInput): Garment
    duplicate(id: number): Garment
    archive(id: number): Garment
    restore(id: number): Garment
    pickCsv(): { fileName: string; text: string } | null
    importRows(rows: GarmentInput[], mode: 'merge' | 'skip'): ImportResult
  }
  pricing: {
    listMatrices(includeArchived: boolean): PricingMatrix[]
    getMatrix(id: number): PricingMatrix
    saveMatrix(input: PricingMatrixInput): PricingMatrix
    duplicateMatrix(id: number): PricingMatrix
    archiveMatrix(id: number): PricingMatrix
    restoreMatrix(id: number): PricingMatrix
    getRules(): PricingRules
    saveRules(input: PricingRulesInput): PricingRules
    listFees(includeArchived: boolean): FeePreset[]
    saveFee(input: FeePresetInput): FeePreset
    archiveFee(id: number): FeePreset
    restoreFee(id: number): FeePreset
    listInks(includeArchived: boolean): Ink[]
    saveInk(input: InkInput): Ink
    archiveInk(id: number): Ink
    restoreInk(id: number): Ink
  }
  backup: {
    list(): BackupInfo[]
    now(): BackupInfo
    pickAndRestore(): { restarting: boolean } | null
    restore(path: string): { restarting: boolean }
    reveal(): void
  }
  search: {
    global(query: string): SearchResult[]
  }
  quotes: {
    list(filter: QuoteFilter): QuoteListRow[]
    get(id: number): QuoteDetail
    create(opts: { customer_id?: number | null }): QuoteRecord
    save(input: QuoteEdit): QuoteDetail
    pricingBase(): PricingBase
    markSent(id: number): QuoteDetail
    approve(id: number, approvedBy: string): QuoteDetail
    decline(id: number, reason: string): QuoteDetail
    revise(id: number): QuoteRecord
    duplicate(id: number): QuoteRecord
    reorder(id: number): QuoteRecord
    archive(id: number): QuoteDetail
    restore(id: number): QuoteDetail
    /** approved quote → invoice */
    convert(id: number): InvoiceRecord
  }
  invoices: {
    list(filter: InvoiceFilter): InvoiceListRow[]
    get(id: number): InvoiceDetail
    create(opts: { customer_id?: number | null }): InvoiceRecord
    save(input: InvoiceEdit): InvoiceDetail
    markSent(id: number): InvoiceDetail
    void(id: number, reason: string): InvoiceDetail
    reprice(id: number): InvoiceDetail
    archive(id: number): InvoiceDetail
    restore(id: number): InvoiceDetail
  }
  payments: {
    record(input: PaymentInput): Payment
    void(id: number, reason: string): Payment
  }
  attachments: {
    /** paths from drag and drop; null opens a file picker */
    add(ownerType: 'quote' | 'invoice', ownerId: number, paths: string[] | null): Attachment[]
    update(id: number, patch: AttachmentPatch): Attachment
    remove(id: number): void
  }
  documents: {
    preview(kind: DocumentKind, id: number): CustomerDocument
    savePdf(kind: DocumentKind, id: number): string | null
    openPdf(kind: DocumentKind, id: number): string
  }
  reports: {
    dashboard(): DashboardSummary
    sales(range: ReportRange): SalesPeriodRow[]
    byCustomer(range: ReportRange): SalesByCustomerRow[]
    salesTax(range: ReportRange): SalesTaxRow[]
    payments(range: ReportRange): PaymentsByMethodRow[]
    winRate(range: ReportRange): WinRateReport
    /** save CSV text through a Save dialog */
    exportCsv(suggestedName: string, csv: string): string | null
  }
  production: {
    board(): BoardJob[]
    setStatus(job: JobRef, status: ProductionStatus | null): void
    garmentOrder(jobs: JobRef[]): GarmentOrder
    garmentOrderPdf(jobs: JobRef[], mode: 'open' | 'save'): string | null
    markOrdered(jobs: JobRef[]): void
  }
  email: {
    compose(kind: DocumentKind, id: number): EmailCompose
    send(input: EmailSendInput): { to: string[] }
    prepareManual(input: EmailSendInput): { file: string }
    test(to: string): void
  }
}

type MethodMap = { [D in keyof Api]: { [M in keyof Api[D]]: true } }

export const API_METHODS: MethodMap = {
  app: { info: true, openDataFolder: true, openAttachment: true, revealAttachment: true },
  settings: { get: true, save: true, completeSetup: true, pickLogo: true, clearLogo: true, setSmtpPassword: true, encryptionAvailable: true },
  customers: {
    list: true,
    get: true,
    save: true,
    archive: true,
    restore: true,
    tags: true,
    saveContact: true,
    deleteContact: true,
    attachCert: true,
    removeCert: true
  },
  garments: { list: true, get: true, save: true, duplicate: true, archive: true, restore: true, pickCsv: true, importRows: true },
  pricing: {
    listMatrices: true,
    getMatrix: true,
    saveMatrix: true,
    duplicateMatrix: true,
    archiveMatrix: true,
    restoreMatrix: true,
    getRules: true,
    saveRules: true,
    listFees: true,
    saveFee: true,
    archiveFee: true,
    restoreFee: true,
    listInks: true,
    saveInk: true,
    archiveInk: true,
    restoreInk: true
  },
  backup: { list: true, now: true, pickAndRestore: true, restore: true, reveal: true },
  search: { global: true },
  quotes: {
    list: true,
    get: true,
    create: true,
    save: true,
    pricingBase: true,
    markSent: true,
    approve: true,
    decline: true,
    revise: true,
    duplicate: true,
    reorder: true,
    archive: true,
    restore: true,
    convert: true
  },
  invoices: {
    list: true,
    get: true,
    create: true,
    save: true,
    markSent: true,
    void: true,
    reprice: true,
    archive: true,
    restore: true
  },
  payments: { record: true, void: true },
  attachments: { add: true, update: true, remove: true },
  documents: { preview: true, savePdf: true, openPdf: true },
  email: { compose: true, send: true, prepareManual: true, test: true },
  reports: { dashboard: true, sales: true, byCustomer: true, salesTax: true, payments: true, winRate: true, exportCsv: true },
  production: { board: true, setStatus: true, garmentOrder: true, garmentOrderPdf: true, markOrdered: true }
}

/** What the renderer sees: every method returns a Promise. */
export type RendererApi = {
  [D in keyof Api]: {
    [M in keyof Api[D]]: Api[D][M] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never
  }
}

/** Main-process implementation: may be sync or async. */
export type ApiImpl = {
  [D in keyof Api]: {
    [M in keyof Api[D]]: Api[D][M] extends (...a: infer A) => infer R ? (...a: A) => R | Promise<R> : never
  }
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { message: string; fields?: Record<string, string> } }

/** Events main sends to the renderer (menu shortcuts, background jobs). */
export type MainEvent = { type: 'navigate'; to: string } | { type: 'new-quote' } | { type: 'backup-done'; backup: BackupInfo } | { type: 'command-palette' }

export const channel = (domain: string, method: string) => `api:${domain}.${method}`
