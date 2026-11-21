# Inkwell: build plan

Local-first desktop app for a screen printing shop: quotes, invoices, payments, PDFs, and
(Phase 5) spot-color separations. Source spec: `docs/BUILD_PROMPT.md`. Decisions not covered
by the spec go in `docs/DECISIONS.md`; out-of-scope ideas in `docs/FUTURE.md`.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done and tested.

---

## 1. Architecture

```
┌──────────────────────── Electron main process (Node) ────────────────────────┐
│ db/        better-sqlite3, migrations, repositories (one per aggregate)       │
│ ipc/       typed handlers: one module per domain, registered from a table     │
│ pdf/       hidden BrowserWindow → loads pdf.html → printToPDF                 │
│ backup/    daily + manual backup, restore (relaunch)                          │
│ email/     nodemailer over user SMTP (Phase 3)                                │
│ files/     attachments, logo, CSV import, save/open dialogs                   │
│ separations/  SVG/PDF import, color detect, boolean ops, film output (Ph. 5) │
└───────────────▲──────────────────────────────────────────────────────────────┘
                │ contextBridge: window.api.<domain>.<method>(...) → Promise
┌───────────────┴──────── preload (typed, no Node exposed) ────────────────────┐
└───────────────▲──────────────────────────────────────────────────────────────┘
┌───────────────┴──────── renderer (React + TS + Tailwind) ────────────────────┐
│ routes, screens, components (shadcn-style), TanStack Query for IPC data       │
│ live quote math runs here too, importing the same pure pricing module         │
└──────────────────────────────────────────────────────────────────────────────┘
             src/shared/  ← types, IPC contract, pricing engine, money, numbering
```

Principles:
- **Renderer never touches the DB.** Every read/write is a typed IPC call. The IPC contract
  (`src/shared/ipc.ts`) is one TypeScript map of `channel → (args) => result`; preload and main
  are both type-checked against it, so a mismatch fails the build.
- **Pricing is pure.** `src/shared/pricing/` has no imports from Electron, DB, or React. The
  renderer uses it for live totals; main uses the same code when saving, converting, and
  rendering PDFs, so the number on screen is the number on the PDF.
- **Money is integer cents** (`type Cents = number` branded, always an integer). Percentages
  are stored as basis points (`825` = 8.25%) so tax rates are integers too.
- **Writes are transactional.** Each repository mutation runs inside `db.transaction()`.
  Number allocation, quote→invoice conversion, and payment recording are single transactions.
- **Offline.** No network calls at all except user-initiated SMTP. Fonts, icons, and templates
  are bundled. No telemetry, no auto-update (an update check would be a cloud service: ask first).

### Stack (versions checked 2026-11-21, all MIT/Apache/MIT-0)

| Purpose | Package |
|---|---|
| Shell, build | `electron` 45, `electron-vite` 6, `vite`, `typescript` |
| UI | `react` 19, `react-router`, `tailwindcss` 4, Radix primitives + shadcn-style components (copied into repo, not a dependency), `lucide-react` icons, `@tanstack/react-query`, `react-hook-form` + `zod` |
| DB | `better-sqlite3` (rebuilt for Electron via `electron-builder install-app-deps`) |
| CSV | `papaparse` |
| Drag and drop ordering | `@dnd-kit/core` |
| Email (Ph. 3) | `nodemailer` |
| Separations (Ph. 5) | `paper` (paper.js), `pdfjs-dist` (Apache-2.0) for PDF/.AI import |
| Tests | `vitest`, `@playwright/test` (`_electron` mode) |
| Packaging | `electron-builder` → NSIS `.exe`, `.dmg` |
| Font | Inter (SIL OFL), bundled `.woff2` |

---

## 2. Folder structure

```
inkwell/
├─ docs/  BUILD_PROMPT.md  PLAN.md  DECISIONS.md  FUTURE.md
├─ resources/            app icons, bundled font
├─ src/
│  ├─ shared/            (no Electron/Node/DOM imports)
│  │  ├─ money.ts        cents helpers, round-half-up, formatting
│  │  ├─ types.ts        domain types (Quote, LineItem, Imprint, ...)
│  │  ├─ ipc.ts          IPC contract
│  │  ├─ sizes.ts        size list, size → size-group mapping
│  │  ├─ numbering.ts    format Q-1001, revisions Q-1001-R2, file names
│  │  ├─ merge-fields.ts email template merge
│  │  └─ pricing/
│  │     ├─ index.ts     priceQuote(input, config) → QuoteBreakdown
│  │     ├─ garment.ts   markup
│  │     ├─ decoration.ts matrix lookup, underbase, adders
│  │     ├─ grouping.ts  combined-quantity keys across line items
│  │     ├─ fees.ts      per-job / per-piece, screens, minimums, rush
│  │     ├─ totals.ts    discount → rush → tax → shipping → deposit
│  │     └─ *.test.ts
│  ├─ main/
│  │  ├─ index.ts        app lifecycle, windows, menu, shortcuts
│  │  ├─ db/  connection.ts  migrate.ts  migrations/001_init.sql ...  repos/*.ts  seed.ts
│  │  ├─ ipc/            one file per domain + register.ts
│  │  ├─ pdf/            render.ts (hidden window → printToPDF)
│  │  ├─ backup/         backup.ts (scheduler, keep 30, restore)
│  │  ├─ email/          send.ts
│  │  ├─ files/          attachments.ts csv-import.ts dialogs.ts
│  │  └─ separations/    import/ detect.ts merge.ts geometry.ts underbase.ts halftone.ts film.ts
│  ├─ preload/index.ts
│  └─ renderer/
│     ├─ index.html  pdf.html          (pdf.html = print template entry)
│     ├─ app/        App.tsx router.tsx layout (sidebar + search bar) command-palette
│     ├─ components/ ui/ (button, input, dialog, table, ...) money-input size-grid ...
│     ├─ features/   dashboard quotes invoices customers catalog pricing settings
│     │              reports production garment-orders separations setup-wizard
│     ├─ pdf-templates/  Document.tsx (quote | invoice | receipt | garment-order | film)
│     └─ lib/        api.ts (typed window.api wrapper) hooks
├─ test/  fixtures/ (SVGs, CSV, sample DB)  e2e/*.spec.ts
├─ electron.vite.config.ts  electron-builder.yml  vitest.config.ts  playwright.config.ts
└─ README.md
```

---

## 3. Data model (SQLite)

Conventions: `id INTEGER PRIMARY KEY`; `created_at`, `updated_at` (ISO text, set by repos);
`archived_at` nullable for soft delete on customers, garments, quotes, invoices, fee presets,
matrices, inks. Money columns end in `_cents` (INTEGER). Rates end in `_bp` (basis points).
JSON columns are TEXT validated by zod on read. Foreign keys ON. Migrations are
`NNN_name.sql`, run in order inside a transaction at startup, tracked in `schema_migrations`.

**settings** (single row, `id = 1`)
shop_name, logo_path, address_line1/2, city, state, postal_code, country, phone, email, website,
tax_id, default_tax_bp, default_deposit_bp, quote_expiration_days, default_payment_terms
(e.g. `net_15`, `due_on_receipt`), payment_terms_days, quote_prefix, quote_next_number,
invoice_prefix, invoice_next_number, receipt_prefix, receipt_next_number, currency (`USD`),
accent_color, pdf_footer_text, terms_text, how_to_pay_text, rounding_mode (`cent` | `nickel` |
`quarter`), combine_quantities (bool, default 1), ink_labor_cost_per_piece_cents,
smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password_enc (BLOB, `safeStorage`),
smtp_from_name, email_quote_subject/body, email_invoice_subject/body, email_receipt_subject/body,
film_* defaults (page size, mirror, reg marks, PNG DPI, max print area), theme,
setup_completed_at, last_backup_at.

**customers**: company_name, first_name, last_name, email, phone, billing_* address, shipping_*
address, shipping_same_as_billing, tax_exempt, exempt_cert_number, exempt_cert_attachment_id,
exempt_cert_expires_on, pricing_tier_id → pricing_matrices (nullable: default matrix set),
notes, tags (JSON array), archived_at. Index on lower(company_name), lower(last_name), email.

**customer_contacts**: customer_id, name, email, phone, role.

**garments**: brand, style_number, name, category (enum), supplier (enum + `supplier_other`),
colors (JSON `[{name, hex, is_dark}]`), sizes (JSON `["S","M",...]`),
cost_base_cents (S–XL), cost_2xl_cents, cost_3xl_cents, cost_4xl_plus_cents, notes, active.
Unique (brand, style_number) among non-archived rows.

**pricing_matrices**: name, method (`screen` | `embroidery` | `dtf` | `transfer` | `other`),
is_sample, above_max_rule (`use_last` | `per_extra_color` | `not_allowed`),
above_max_adder_cents, notes.
**pricing_matrix_breaks**: matrix_id, min_qty (row header). **pricing_matrix_columns**:
matrix_id, colors (1..N; for embroidery the column is a stitch-count band `max_stitches`; for
DTF a size band). **pricing_matrix_cells**: break_id, column_id, price_cents.
(Normalized so add/remove rows and columns are simple inserts/deletes; the grid editor reads a
denormalized view.)

**pricing_rules** (one row per rule set; `id = 1` is active; room for tiers later):
markup_mode (`percent` | `multiplier`), markup_tiers (JSON `[{up_to_cost_cents, value}]`),
underbase_mode (`plus_one_color` | `flat_adder`), underbase_adder_cents,
specialty_adders (JSON `{puff, glow, metallic, discharge, water_based, high_density}` → cents
per piece per imprint), oversize_adders (JSON `{oversized, jumbo}`),
size_upcharges (JSON `{"2XL":200,"3XL":300,"4XL+":400}`), min_order_qty,
below_min_fee_cents, rush_mode (`percent` | `flat`), rush_value, screen_fee_cents,
screen_fee_basis (`per_color` | `per_screen`), reorder_screen_discount_bp, digitizing_fee_cents.

**fee_presets**: name, amount_cents, basis (`per_job` | `per_piece` | `per_hour`), taxable,
kind (`screen` | `film` | `digitizing` | `art` | `shipping` | `rush` | `other`), sort_order.

**quotes**: number (text, unique, e.g. `Q-1001` or `Q-1001-R2`), base_number (int),
revision (int, 1 = original), previous_revision_id, customer_id, contact_id, status (`draft` |
`sent` | `approved` | `declined` | `expired` | `superseded`), job_name, issued_on,
expires_on, in_hands_on, customer_notes, internal_notes, tax_bp_override, discount_mode
(`percent` | `flat`), discount_value, deposit_bp, rush (bool), is_reorder (bool),
approved_at, approved_by_name, sent_at, converted_invoice_id, production_status,
totals_snapshot (JSON, cached for list views and reports), archived_at.

**quote_line_items**: quote_id, sort_order, garment_id (nullable), garment_snapshot (JSON:
brand, style, name, costs: frozen so catalog edits don't change old quotes), custom_description,
customer_supplied (bool), color_name, color_hex, is_dark, design_key (see §4),
matrix_id (nullable → default for method).
**quote_line_sizes**: line_item_id, size (text), size_group (`base` | `2xl` | `3xl` | `4xl_plus`),
qty, sort_order.
**quote_line_prices**: line_item_id, size_group, calculated_unit_cents, override_unit_cents
(nullable), override_reason. Override is flagged in UI and in the breakdown.
**quote_imprints**: line_item_id, location (enum + custom), method, colors, underbase,
underbase_source (`auto` | `manual` | `separations`), specialty (JSON flags), print_size
(`standard` | `oversized` | `jumbo`), stitch_count, new_digitizing, transfer_size,
transfer_w_in, transfer_h_in, is_reorder, separation_job_id, artwork_attachment_id.
**quote_fees**: quote_id, fee_preset_id (nullable), name, basis, quantity, amount_cents,
taxable, auto (bool: system-computed like screens/below-min; user can detach to edit).

**invoices**: number, source_quote_id, customer_id, contact_id, status (`draft` | `sent` |
`partially_paid` | `paid` | `void`; `overdue` is computed, not stored), issued_on, due_on,
payment_terms, job_name, customer_notes, internal_notes, tax_bp, discount_mode,
discount_value, rush, production_status, sent_at, voided_at, void_reason, totals_snapshot.
**invoice_line_items / invoice_line_sizes / invoice_line_prices / invoice_imprints /
invoice_fees**: same columns as the quote tables, with `invoice_id`. On conversion the final
unit prices are frozen into `invoice_line_prices.final_unit_cents`; invoice math never
re-reads the catalog or matrices unless the user explicitly hits "Reprice".

**payments**: invoice_id (nullable), quote_id (nullable: deposit taken before conversion;
`CHECK (invoice_id IS NOT NULL OR quote_id IS NOT NULL)`), received_on, amount_cents (> 0),
method (enum), check_number, reference, note, is_deposit, receipt_number.
On conversion, quote deposits get `invoice_id` set (carry over).

**attachments**: owner_type (`quote` | `invoice` | `customer` | `separation`), owner_id,
rel_path (under userData/attachments), original_name, mime, kind (`mockup` | `artwork` |
`proof` | `tax_cert` | `film` | `other`), caption, include_in_pdf, sort_order.

**separation_jobs**: source_attachment_id, quote_imprint_id, invoice_imprint_id,
detected_colors (JSON), color_mapping (JSON), ink_order (JSON), underbase (JSON),
trap (JSON), halftone (JSON), film_options (JSON), output_attachment_id, status.

**inks**: name, pms, hex, type (`plastisol` | `water_based` | `discharge` | `specialty`), notes.

**activity_log**: entity_type, entity_id, action, details (JSON), created_at. Index
(entity_type, entity_id).

**number_counters**: lives in `settings` (`*_next_number`). Allocation is
`UPDATE settings SET quote_next_number = quote_next_number + 1 RETURNING ...` inside the
create transaction. Numbers are never decremented, so deletes never free a number.
Users can raise the next number in Settings but never lower it below the highest issued.

---

## 4. Pricing engine design (`src/shared/pricing/`)

```ts
priceQuote(input: QuoteInput, cfg: PricingConfig, opts: { taxExempt, certExpired, today })
  → QuoteBreakdown {
      lines: [{ lineId, qty, groups: [{ group, qty, garmentCents, decorationCents,
                upchargeCents, unitCents, overridden, lineGroupTotalCents }],
                imprints: [{ matrixPriceCents, effectiveColors, adders[], breakQty }],
                lineTotalCents, garmentCostCents }],
      fees: [{ name, amountCents, taxable, auto }],
      itemsSubtotal, feesSubtotal, subtotal, discount, rush, taxableBase, tax,
      shipping, grandTotal, depositDue, balance, cost, profit, marginBp, warnings[] }
```

Steps (matching spec §4):
1. **Quantities.** Line qty = Σ sizes. **Break quantity** per imprint = Σ qty of all lines with
   the same `design_key` when `combine_quantities` is on, else the line's own qty.
   `design_key` = stable hash of the line's sorted imprint signatures
   (location, method, colors, underbase, specialty flags, print size / stitch count / transfer
   size). Lines in different shirt colors with identical imprints share a break. Per-imprint
   combining (a shared front but different backs) is a refinement noted in DECISIONS.
2. **Garment price** per size group = cost × markup (tier chosen by cost). Customer-supplied →
   0 garment price (use the contract matrix).
3. **Decoration** per piece = Σ imprints: matrix cell at (largest break ≤ qty, colors).
   Underbase: `plus_one_color` bumps the color column; `flat_adder` adds cents. Colors above
   max column → `above_max_rule`. Qty below the first break → first break price plus a
   below-minimum warning and fee. Specialty and oversize adders per imprint.
4. **Size upcharge** per group from rules.
5. **Unit price** = garment + decoration + upcharge, rounded half-up to the cent, then to
   nearest $0.05 / $0.25 if that mode is on. **Manual override** replaces the unit price
   for that size group, and the breakdown keeps both values.
6. **Line total** = Σ unit × qty per group.

Quote level:
- Auto fees: screens = Σ over screen-print imprints of (colors + underbase) per unique design
  (screens are burned once per design, not per shirt color) × screen fee; reorder imprints
  apply `reorder_screen_discount_bp`. Digitizing per new embroidery design. Below-minimum fee.
- `subtotal = items + fees (excluding shipping)`
- `discount` (percent of subtotal, or flat capped at subtotal)
- `rush` = percent of (subtotal − discount) or flat
- `taxableBase` = taxable share of (subtotal − discount + rush). The discount is allocated
  pro-rata between taxable and non-taxable amounts, so a discount lowers tax fairly.
- `tax` = round-half-up(taxableBase × rate). Zero if customer is tax-exempt with a cert that is
  not expired; if expired, tax is still skipped but a blocking warning appears ("exempt
  certificate expired on …") with a one-click "charge tax" toggle. See DECISIONS.
- `shipping` added after tax (taxable only if its fee is marked taxable; then it joins the base).
- `grandTotal`, `depositDue = round(grandTotal × deposit_bp)`, `balance = grandTotal − paid`.
- Profit = revenue (excl. tax and shipping) − garment cost − ink/labor per piece. Margin in bp.

Test plan (`*.test.ts`, written first):
break boundaries 23/24/47/48; colors above max for each rule; underbase both modes and dark
auto-suggest; size upcharges; combined vs separate quantities; customer-supplied; discounts
before tax (percent and flat, flat > subtotal); mixed taxable/non-taxable; tax-exempt valid and
expired; rounding (cent, nickel, quarter, half-up at .5 boundaries); overrides; zero-qty lines,
empty quote, no imprints; reorder screens; deposit and balance; numbering and revisions;
quote→invoice conversion freezes prices (repo-level test against an in-memory DB).

---

## 5. Cross-cutting pieces

- **PDF**: `pdf.html` is a separate renderer entry that renders `<Document type=… data=…/>`
  from a JSON payload. Main opens a hidden `BrowserWindow`, waits for a `ready` signal (fonts
  and images loaded), then calls `printToPDF({ pageSize: 'Letter', printBackground: true,
  displayHeaderFooter: true, footerTemplate: 'Page <span class=pageNumber> of
  <span class=totalPages>' })`. CSS: `thead { display: table-header-group }`,
  `tr, .line-item { break-inside: avoid }`. In-app Preview renders the same component in an
  iframe at Letter proportions. Images load as `file://` from userData via a custom
  `inkwell-file://` protocol (no web access).
- **Autosave**: quote builder form state debounced 500 ms → `quotes.save`. Saves are
  idempotent upserts of the whole quote aggregate in one transaction.
- **Expiry and overdue**: computed on read (`status = 'sent' AND expires_on < today` → shows
  Expired); a startup + hourly sweep persists `expired` and logs it.
- **Backup**: `db.backup(path)` (online, consistent). On startup if `last_backup_at` > 24 h, and
  every 24 h while running. Keep the newest 30 in `userData/backups`. Restore: pick file →
  validate (open read-only, check `schema_migrations`) → back up the current DB first → copy →
  `app.relaunch()`.
- **Validation**: zod schemas in `src/shared/schemas.ts`, shared by forms and IPC handlers
  (main re-validates everything it receives).
- **Activity log**: written by repos in the same transaction as the change.
- **Theme**: light/dark/system, Tailwind `dark:` class strategy, accent color from settings.

---

## 6. Feature checklist

### Phase 1: Foundation, customers, catalog, settings
- [ ] Project scaffold (electron-vite, React, TS, Tailwind, lint, Vitest, Playwright)
- [ ] `src/shared/money.ts` + tests
- [ ] Migration runner + `001_init.sql` (all tables in §3, so later phases don't churn the core schema)
- [ ] Typed IPC contract, preload bridge, main registration
- [ ] App shell: sidebar (Dashboard, Quotes, Invoices, Customers, Catalog, Pricing, Settings), top search bar, light/dark mode
- [ ] First-run setup wizard: shop info, logo upload, tax rate, numbering prefixes/start numbers, default terms
- [ ] Seed sample matrices, rules, fee presets, inks (labeled "Sample: edit these to match your pricing")
- [ ] Customers: list with search/filter/sort, create/edit/archive/restore, contacts, tax-exempt fields + cert upload + expiry
- [ ] Customer detail: quotes, invoices, balance owed, exempt status (lists empty until Ph. 2/3, but wired)
- [ ] Garment catalog: CRUD, colors (with dark flag), sizes, size-group costs, supplier, duplicate, archive
- [ ] CSV import with column mapping (brand, style, name, color, sizes, cost) + preview + merge by brand/style
- [ ] Pricing: matrix list, grid editor (add/remove breaks and color columns, inline cells, above-max rule)
- [ ] Pricing rules form; fee presets CRUD
- [ ] Settings page covering every `settings` field (SMTP password via safeStorage)
- [ ] Daily auto-backup (keep 30), Backup now, Restore from backup
- [ ] Tests: money, migrations on fresh DB, numbering allocation, CSV mapping, backup rotation
- [ ] E2E smoke: launch, complete wizard, create customer, create garment

### Phase 2: Quote builder and PDF
- [ ] Pricing engine (§4) with the full test list
- [ ] Quote builder: inline customer pick/create; line items from catalog or custom/customer-supplied; color pick; tab-through size grid with live total
- [ ] Imprints per line: location, method, method-specific fields, underbase auto-suggest on dark, specialty flags
- [ ] Duplicate line item; Apply same imprints to all lines
- [ ] Fees from presets or custom; auto fees (screens, below-min, digitizing, rush)
- [ ] Live totals sidebar incl. deposit and internal profit/margin
- [ ] Per-line internal pricing breakdown panel; manual unit-price override (flagged)
- [ ] Mockup attachments (drag and drop) with include-in-PDF toggle
- [ ] Notes (customer/internal), expiration, in-hands date; autosave drafts
- [ ] Statuses Draft → Sent → Approved/Declined/Expired; auto-expire; Revise → `Q-1001-R2` with history
- [ ] Quote PDF (all spec items; never shows cost/markup/margin/internal notes) + in-app Preview
- [ ] Shared PDF template system, bundled font, page numbers, repeating headers, no split line items, file naming
- [ ] Quotes list with status/customer/date filters and columns
- [ ] Duplicate quote; Reorder (copies, marks screens reorder)
- [ ] Tests: engine, numbering/revisions, PDF payload never contains internal fields
- [ ] E2E smoke: build a quote, export PDF

### Phase 3: Invoices, payments, sending
- [ ] Convert approved quote → invoice (one click, links both ways, activity log, frozen prices)
- [ ] Invoice from scratch
- [ ] Invoice statuses incl. computed Overdue, Void (with reason)
- [ ] Record payments/deposits; history; balance on invoice and customer
- [ ] Quote deposit carries to invoice
- [ ] Invoice PDF (terms, payments, balance due, how-to-pay, PAID stamp)
- [ ] Receipt PDF per payment
- [ ] Save PDF / Open PDF
- [ ] Email via SMTP with merge-field templates and PDF attached; mark Sent; log
- [ ] No-SMTP fallback: generate PDF, reveal folder, copy body to clipboard
- [ ] SMTP "Send test email" in Settings
- [ ] Tests: conversion, payment status transitions, overdue, merge fields
- [ ] E2E smoke: approve → convert → record payment → PAID

### Phase 4: Dashboard, reports, polish
- [ ] Dashboard widgets (awaiting response, expiring this week, outstanding, overdue, revenue MoM, upcoming in-hands)
- [ ] Reports + CSV export: sales by month, by customer, sales tax by period (taxable vs exempt), payments by method, win rate
- [ ] Global search; command palette (Ctrl/Cmd+K); Ctrl/Cmd+N; Ctrl/Cmd+P
- [ ] Production status field + board view
- [ ] Garment order list (supplier → style → color → size), CSV + PDF
- [ ] Packaging: Windows NSIS + macOS dmg, icon, version in Settings → About
- [ ] README complete
- [ ] Tests: report queries on fixture data

### Phase 5: Separations (see `docs/BUILD_PROMPT.md` §6A)
- [ ] Spike: paper.js boolean/offset ops headless in main (or a hidden window if paper needs a DOM)
- [ ] SVG import (paths, basic shapes, transforms, `<use>`, CSS/presentation fills, strokes → outlines)
- [ ] PDF/.AI import via pdf.js operator list → paths (licensing check passed: Apache-2.0)
- [ ] EPS only if Inkscape/Ghostscript is detected on the machine; otherwise a clear re-save message
- [ ] Warnings: embedded raster (with areas), live text / missing fonts, mostly-raster files
- [ ] Preview on checkerboard + garment color background
- [ ] Color detection with swatch, hex, % coverage
- [ ] Merge by tolerance (ΔE slider) + manual drag merge; drop colors; ink library mapping
- [ ] Ink order (drag), default light → dark, underbase first
- [ ] Knockout by default, per-color overprint
- [ ] Trap spread on top colors
- [ ] Underbase = union − exclusions, choked; optional highlight white
- [ ] Halftones for gradients/tints (beta): LPI, dot shape, angle
- [ ] Preview toggles: per plate, composite, film view
- [ ] Film PDF: 100% size, page sizes, oversize warning, solid K, reg/center marks, label, mirror, invert, fill bar, multi-page or per-plate, PNG at DPI
- [ ] Save films to attachments, link to imprint; auto-fill colors/underbase with "from separations" badge; feeds screen fee
- [ ] Film thumbnails on job detail and production views
- [ ] Tests + fixtures (1-color text, 3-color overlap, thin strokes, gradient, dark-garment underbase); 100% scale check

---

## 7. Open questions / risks

1. **PDF/.AI import (Ph. 5)**: plan is pdf.js (Apache-2.0), reading the operator list to
   rebuild vector paths. That avoids MuPDF/Ghostscript (AGPL). Risk: pdf.js has no SVG
   export anymore, so the path rebuild is custom code. If it turns out to be inadequate for
   real .AI files, I'll stop and present options before adding anything copyleft.
2. **Film PNG at 720 DPI (Ph. 5)**: plan is to render each plate SVG in a hidden window at
   the right zoom and `capturePage`, tiling if large. A 13×19" plate at 720 DPI is ~9360×13680 px,
   so tiling is required. No extra dependency.
3. **Code signing**: unsigned installers will trigger SmartScreen on Windows and Gatekeeper
   on macOS. Signing requires paid certificates/accounts, so I won't set it up without asking.
   README will document the right-click → Open workaround.
4. **Building installers from Linux**: the Windows build can be cross-compiled; the macOS `.dmg`
   has to be built on a Mac. Config and scripts will be ready, and README says how.
