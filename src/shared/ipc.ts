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
  invoices: Array<{ id: number; number: string; job_name: string; status: string; total_cents: number; balance_cents: number; issued_on: string }>
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
  search: { global: true }
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
export type MainEvent = { type: 'navigate'; to: string } | { type: 'backup-done'; backup: BackupInfo } | { type: 'command-palette' }

export const channel = (domain: string, method: string) => `api:${domain}.${method}`
