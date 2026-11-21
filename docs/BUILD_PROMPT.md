# Build Prompt: "Inkwell" — Local Quote & Invoice App for a Screen Printing Shop

> Paste this whole file into Claude Code (or save it as `BUILD_PROMPT.md` in an empty folder and tell Claude Code: "Read BUILD_PROMPT.md and build it, phase by phase"). The app name "Inkwell" is a placeholder. Change it if you like.

---

## 0. Your role and how to work

You are building a production-quality, **local-first desktop application** for a small custom apparel / screen printing shop. It replaces cloud tools like Printavo and Teesom for one specific job: **building accurate quotes fast, turning approved quotes into invoices, tracking payments, and sending professional PDFs to customers.**

Working rules:
1. **Plan first.** Before writing code, write `docs/PLAN.md` with the architecture, folder structure, data model, and a checklist of every feature in this document. Keep that checklist up to date as you finish items.
2. **Build in the phases below, in order.** Finish, test, and commit each phase before starting the next. Don't stub features out with "TODO" and move on. If something is in a phase, it works at the end of that phase.
3. **Money is never a float.** Store all currency as integer cents. All pricing math runs through one pure, fully unit-tested pricing module.
4. **Write tests** for the pricing engine, totals, tax, numbering, and the quote-to-invoice conversion. Run them before you call a phase done.
5. **Ask me before** adding any cloud service, account, paid dependency, or telemetry. The app must work fully offline.
6. When a decision isn't covered here, pick the simple, conventional option, write it down in `docs/DECISIONS.md`, and keep going.

---

## 1. Tech stack

- **Electron + React + TypeScript + Vite** (use electron-vite or a similar maintained template)
- **SQLite** via `better-sqlite3`, with a simple migration system (numbered SQL files run at startup)
- **PDF generation:** render the document as an HTML/CSS template in a hidden window and use Electron's `webContents.printToPDF`. This gives pixel-accurate, print-ready Letter-size PDFs without a separate PDF library.
- **UI:** Tailwind CSS plus a lightweight component set (shadcn/ui or similar). Clean, fast, keyboard-friendly. Light and dark mode.
- **State/data:** IPC layer between renderer and main process with typed channels. No direct DB access from the renderer.
- **Email (optional, Phase 3):** `nodemailer` with SMTP settings the user enters (Gmail app password, Outlook, etc.)
- **Testing:** Vitest for logic, Playwright (Electron mode) for a few end-to-end smoke tests.
- **Packaging:** electron-builder for **Windows (.exe installer) and macOS (.dmg)**.
- **Separations (Phase 5):** `paper.js` (headless, for vector boolean operations: union, subtract, offset) or an equivalent maintained geometry library; SVG parsing in-process. See section 6A for file-format handling and licensing rules.

Data location: the OS app-data folder (`app.getPath('userData')`), holding `inkwell.db`, plus `/attachments` (mockups, artwork) and `/pdfs` (generated documents).

---

## 2. Core concepts (domain model)

A screen printing quote is **not** a simple "item × price" list. Model it the way a print shop actually thinks:

- A **Quote** contains one or more **Line Items**.
- A **Line Item** = one garment style in one color (e.g. "Gildan 5000 – Black") with a **size breakdown** (XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL, plus custom sizes like youth sizes) and one or more **Imprints**.
- An **Imprint** = one decoration on one location (Front, Back, Left Chest, Right Sleeve, Left Sleeve, Neck/Tag, custom) using one **decoration method** (Screen Print, Embroidery, DTF, Heat Transfer/Vinyl, Other), with method-specific details:
  - Screen print: number of ink colors, whether it needs an **underbase** (auto-suggest yes on dark garments), specialty ink flags (puff, glow, metallic, discharge, water-based, high-density), print size category (standard / oversized / jumbo).
  - Embroidery: stitch count, whether a new digitizing charge applies.
  - DTF/transfer: print size (small / medium / large / custom in inches).
- **Fees** are either per-job (screens/setup, film, digitizing, art time, rush, shipping) or per-piece.
- An **Invoice** is created from an approved quote (copy of its line items, frozen pricing) or from scratch.
- **Payments** (deposits and partial payments) apply against an invoice.

---

## 3. Data model (SQLite)

Design the schema to cover at least these tables. Add indexes, timestamps (`created_at`, `updated_at`), and soft-delete (`archived_at`) where it makes sense.

- `settings`: single row. Shop name, logo path, address, phone, email, website, tax ID, default tax rate, default deposit %, default quote expiration days, default payment terms, quote/invoice number prefixes and next numbers, currency, PDF footer text, terms & conditions text, SMTP settings (password stored encrypted with Electron `safeStorage`).
- `customers`: company name, contact first/last name, email, phone, billing address, shipping address, **tax-exempt flag + resale/exempt certificate number + cert file attachment + expiration date**, default pricing tier, notes, tags.
- `customer_contacts`: additional contacts per customer (name, email, phone, role).
- `garments` (product catalog): brand, style number, name, category (tee, long sleeve, hoodie, crewneck, hat, tote, polo, jacket, other), available colors, available sizes, **cost per piece by size group** (e.g. S–XL cost, 2XL cost, 3XL cost, 4XL+ cost), supplier (S&S Activewear, SanMar, alphabroder, local, other), notes, active flag.
- `pricing_matrices`: named matrices (e.g. "Standard Screen Print", "Contract Print – customer supplied", "Embroidery"). Each matrix is a grid of **quantity breaks × number of colors → price per piece per location**. Include a rule for what happens above the max colors.
- `pricing_rules`: garment markup (percent or multiplier, optionally tiered by cost), underbase handling (counts as +1 color, or flat per-piece adder), specialty ink adders, oversize print adders, size upcharges (e.g. 2XL +$2, 3XL +$3, 4XL+ +$4, editable), minimum order quantity and the below-minimum fee, rush fee (% or flat), screen/setup fee per color/per screen, reprint/reorder screen discount.
- `fee_presets`: reusable fees (Screen Setup, Film Output, Digitizing, Art Time per hour, Color Change, Ink Change, Pantone Match, Fold & Bag, Individual Names/Numbers, Shipping, Rush) with default amount, per-job or per-piece, taxable flag.
- `quotes`: number, customer, contact, status, created date, expiration date, due date (event/in-hands date), title/job name, customer-facing notes, internal notes, tax rate override, discount (percent or flat), deposit required %, approved_at, approved_by_name, converted_invoice_id.
- `quote_line_items`, `quote_line_sizes`, `quote_imprints`, `quote_fees`: as described in section 2. Each line item stores **calculated unit price per size group** and allows a **manual override** that is clearly flagged.
- `invoices` + `invoice_line_items`, `invoice_line_sizes`, `invoice_imprints`, `invoice_fees`: same shape as quotes, frozen at conversion time. Fields: number, source quote id, issue date, due date, payment terms, status.
- `payments`: invoice id, date, amount, method (cash, check w/ number, card, Venmo, PayPal, Zelle, bank transfer, other), reference/note, is_deposit flag.
- `attachments`: owner type and id (quote / invoice / customer), file path, kind (mockup, artwork, proof, tax cert, other), caption, include_in_pdf flag.
- `separation_jobs`: source attachment id, linked quote/invoice imprint id (optional), detected colors JSON, color merge/mapping JSON, ink order, underbase settings, trap/choke settings, halftone settings, output PDF path, created/updated timestamps.
- `inks`: optional ink library (name, Pantone/PMS reference, display hex, type: plastisol / water-based / discharge / specialty, notes) used to name separations and print on film labels.
- `activity_log`: entity type and id, action (created, edited, sent, approved, converted, payment recorded, status change), timestamp, details JSON.

---

## 4. Pricing engine (the most important part)

Create `src/shared/pricing/` as **pure TypeScript functions with no DB or UI dependencies**, fully unit tested.

For each line item, compute:
1. **Total quantity** = sum of all sizes on that line. Quantity breaks use **total quantity of the same design across the whole quote** (setting: "combine quantities across line items that share identical imprints" on by default, since that's how most shops price a run in several shirt colors).
2. **Garment price per piece per size group** = garment cost × markup rule.
3. **Decoration price per piece** = sum over imprints of the matrix lookup (quantity break × color count, adding underbase if that's how the rule works) + specialty/oversize adders.
4. **Size upcharges** per size group.
5. **Unit price per size group** = garment + decoration + size upcharge, rounded to the cent (round-half-up, configurable to round to the nearest $0.05 or $0.25 for cleaner customer pricing).
6. **Line total** = Σ (unit price × qty) for each size group.

Then at the quote level:
- Per-job fees (screens = total screens across all screen-print imprints × screen fee, unless marked reorder), art time, digitizing, etc.
- Below-minimum fee if applicable.
- Subtotal → discount → rush fee → **tax** (only on taxable items; skip entirely for tax-exempt customers with a valid certificate, and warn if the cert is expired) → shipping → **grand total**.
- Deposit due (percent of grand total) and balance.

The UI must show a **pricing breakdown panel** per line item (garment cost, markup, print cost per location, adders, upcharges) visible only to me, never on the customer PDF. Also show **estimated profit and margin** for the whole quote (revenue minus garment cost minus an optional per-piece ink/labor cost from settings).

Write unit tests covering: quantity-break boundaries (e.g. 23 vs 24 vs 48 pieces), color counts above the matrix max, underbase on dark garments, size upcharges, combining quantities across line items, discounts before tax, tax-exempt customers, rounding modes, manual overrides, and zero/edge quantities.

Seed sensible **example** matrices and rules on first run, clearly labeled "Sample — edit these to match your pricing," so the app is usable immediately.

---

## 5. Features by phase

### Phase 1: Foundation, customers, catalog, settings
- App shell: left sidebar (Dashboard, Quotes, Invoices, Customers, Catalog, Pricing, Settings), top search bar.
- **First-run setup wizard:** shop info, logo upload, tax rate, numbering prefixes (e.g. `Q-1001`, `INV-1001`), default terms.
- Customers: list with search/filter/sort, create/edit/archive, detail page showing their quotes, invoices, balance owed, and tax-exempt status.
- Garment catalog: CRUD, CSV import (map columns: brand, style, name, color, sizes, cost), duplicate an item.
- Pricing setup screens: an editable **matrix grid editor** (add/remove quantity breaks and color columns, inline cell editing), pricing rules form, fee presets.
- Settings page covering everything in the `settings` table.
- Database migrations, automatic **daily backup** of the DB to a backups folder (keep the last 30) plus manual "Backup now" and "Restore from backup."

### Phase 2: Quote builder and PDF
- **Quote builder**, the screen I'll live in. Make it fast:
  - Pick or create a customer inline.
  - Add line item → search garment catalog (or type a custom/customer-supplied garment) → pick color → **size grid** with tab-through number inputs and a live total.
  - Add imprints per line item with location, method, colors, underbase toggle, specialty flags.
  - "Duplicate line item" (same design on a different shirt color is the most common action) and "Apply same imprints to all lines."
  - Add fees from presets or custom.
  - Live-updating totals sidebar: subtotal, fees, discount, tax, total, deposit, profit/margin (internal only).
  - Attach mockup images (drag and drop) and choose which appear on the PDF.
  - Customer-facing notes, internal notes, expiration date, in-hands date.
  - Autosave drafts.
- Quote statuses: **Draft → Sent → Approved / Declined / Expired** (auto-mark expired past the expiration date). Allow revisions: "Revise" creates `Q-1001-R2` and keeps history.
- **Quote PDF** (Letter size, print-ready):
  - Header with logo, shop info, quote number, date, expiration, in-hands date.
  - Bill-to / ship-to.
  - Line items grouped by garment: garment name/color, a **compact size breakdown row** (S:10 M:20 L:15 XL:5 2XL:3), imprint summary ("Front – 3 color, Back – 1 color"), unit price(s), line total.
  - Fees, subtotal, discount, tax, total, deposit required.
  - Mockup images section.
  - Terms & conditions and a signature/approval line.
  - Never show cost, markup, margin, or internal notes.
- Quotes list: filter by status, customer, date range; columns for number, customer, job name, total, status, expiration.
- Duplicate a quote; "Reorder" a past job (copies the quote and flags screens as reorder).

### Phase 3: Invoices, payments, sending
- **Convert approved quote → invoice** (one click; links both directions; logs activity). Also allow creating an invoice from scratch.
- Invoice statuses: **Draft → Sent → Partially Paid → Paid**, plus **Overdue** (computed from due date) and **Void**.
- Record payments and deposits; show payment history and balance due on the invoice and on the customer.
- Deposit paid on the quote carries over to the invoice as a payment.
- **Invoice PDF:** same visual system as the quote, with payment terms, payments received, **balance due** shown prominently, and "how to pay" text from settings (Venmo handle, check payable to, etc.). Show a "PAID" stamp when the balance is zero.
- **Sending:**
  - "Save PDF" (choose location) and "Open PDF."
  - "Email" button: if SMTP is configured, send from inside the app with an editable subject/body template (merge fields: `{customer_first_name}`, `{quote_number}`, `{total}`, `{expiration_date}`, `{shop_name}`) and the PDF attached; mark as Sent and log it. If SMTP isn't configured, generate the PDF, open the folder it's in, and copy the email body to the clipboard so I can attach it manually.
  - Receipt PDF for a single payment.

### Phase 4: Dashboard, reports, polish
- Dashboard: quotes awaiting response, quotes expiring this week, outstanding invoice balance, overdue invoices, revenue this month vs last month, upcoming in-hands dates.
- Reports (with CSV export): sales by month, sales by customer, **sales tax collected by period** (taxable vs exempt sales; useful for filing), payments received by method, quote win rate.
- Global search (customers, quote/invoice numbers, job names).
- Keyboard shortcuts: `Ctrl/Cmd+N` new quote, `Ctrl/Cmd+K` command palette/search, `Ctrl/Cmd+P` PDF.
- Simple **production status** on invoices/quotes: Awaiting Art → Proof Sent → Proof Approved → Garments Ordered → Garments Received → In Production → Ready for Pickup → Picked Up / Shipped. Show a simple board view by status.
- **Garment order list:** from selected approved jobs, generate a combined blank-garment order grouped by supplier → style → color → size, exportable as CSV/PDF so I can place the order with my distributor.
- Packaging: build Windows and macOS installers, app icon, version number in Settings → About.

### Phase 5: Spot-color separations from vector artwork
Full spec in section 6A. Build it as its own module (`src/main/separations/` for processing, a "Separations" screen in the UI), opened either from the sidebar or from an imprint's artwork attachment on a quote/invoice.

---

## 6A. Separations spec

**Goal:** load a customer's vector artwork, detect its spot colors, and output one **film positive per screen** (solid black on transparent/white, at 100% actual size) as a print-ready PDF I can run on my film printer. This replaces doing manual separations in Illustrator for typical spot-color jobs.

**Supported input**
- **SVG:** fully supported natively.
- **PDF and PDF-compatible .AI files** (Illustrator saves with PDF compatibility by default): import vector content by converting to SVG/paths. Use a library or bundled tool for this, **but ask me before adding any dependency with a copyleft/AGPL license** (e.g. MuPDF, Ghostscript), and explain the trade-off.
- **EPS:** support only if a converter is available (e.g. a detected Inkscape or Ghostscript install). Otherwise show a clear message telling me to re-save it as PDF or SVG.
- If a file contains **embedded raster images**, warn that raster areas can't be separated as vectors and list which areas are affected.
- Text must be converted to outlines: detect live text/missing fonts and warn me.

**Workflow on the Separations screen**
1. **Import** the file (drag and drop or pick an existing artwork attachment). Show a preview on a checkerboard plus a selectable **garment color background** to simulate the print.
2. **Detect colors:** list every unique fill/stroke color with a swatch, hex, and its % coverage. Treat strokes as filled shapes (expand strokes to outlines).
3. **Merge and map colors:** let me merge near-identical colors (a tolerance slider plus manual drag-to-merge), drop colors (e.g. white on a white shirt, or the garment color so it "shows through"), and assign each remaining color an ink name/Pantone from the ink library.
4. **Ink order:** drag to set print order. Default to lightest-to-darkest, with underbase first.
5. **Knockout vs overprint:** by default each color **knocks out** colors beneath it so inks don't stack. Allow per-color overprint (e.g. a black outline over everything).
6. **Trapping:** a configurable **spread** (e.g. 0.5–1 pt) on top colors so small registration shifts don't leave gaps, applied with path offset operations.
7. **Underbase (dark garments):** optionally generate a white underbase = union of all ink areas except those I exclude, **choked** by a configurable amount (e.g. 0.5–1.5 pt) so it doesn't peek out. Optionally a highlight white printed last.
8. **Gradients/tints (optional, flag as beta):** convert gradient or tint fills into a **halftone** for that color, with configurable LPI (default 45–55), dot shape (round/elliptical), and angle (default 22.5°). Solid areas stay solid.
9. **Preview:** toggle each separation on and off, a "composite" view that recolors each plate with its ink color on the chosen garment color, and a "film view" showing the black plate for each screen.

**Film output (PDF)**
- One page per screen, at **100% actual size**, positioned center on a selectable page size (Letter, Tabloid 11×17, 13×19, custom), with a warning if the art exceeds the page or my configured max print area.
- Pure solid black (100% K, no anti-aliasing tint) on a white/transparent page.
- **Registration marks** (same position on every page), **center marks**, and a **label** outside the image area on each film: job name, quote/invoice number, ink name/Pantone, print order (e.g. "2 of 4"), location (Front/Back), and date.
- Options: **mirror/emulsion side**, invert (for negatives), add a "fill bar"/test strip, and export as one multi-page PDF or individual PDFs/PNGs (PNG at a configurable DPI, default 720).
- Save the output to the job's attachments and link it to the imprint.

**Quote integration**
- When separations are linked to a screen-print imprint, **auto-fill that imprint's color count and underbase flag** (with a visible "from separations" badge I can override). Screen count feeds the screen/setup fee automatically.
- Show the film-positive thumbnails on the job's detail and production views.

**Tests:** unit-test color detection/merging, knockout (subtracting upper plates from lower ones), underbase union + choke, spread, and that output page sizes and scaling are exactly 100%. Include a handful of sample SVGs in `test/fixtures/` (simple 1-color text, 3-color logo with overlaps, art with thin strokes, art with a gradient, art on a dark garment needing underbase).

**Honest limits:** this is for **spot-color vector art**. Simulated process and full CMYK/photographic separations from raster images are out of scope (see section 8). If an imported file is mostly raster, say so plainly instead of producing poor films.

---

## 6. PDF design requirements
- One shared HTML/CSS template system with a document-type switch (quote / invoice / receipt / garment order).
- Clean and professional: shop logo top left, a single accent color (configurable in settings), plenty of whitespace, a readable sans-serif font bundled with the app (not loaded from the web).
- Handles long quotes: repeating table header on page breaks, no line item split awkwardly across pages, page numbers ("Page 1 of 2").
- File naming: `Q-1001_CustomerName_JobName.pdf`, `INV-1001_CustomerName.pdf`.
- Include a **"Preview"** pane in the app that renders the same template before exporting.

---

## 7. Quality bar
- No data loss: confirm before deleting; archived records are recoverable; DB writes are transactional.
- Every form validates (email format, quantities are whole numbers, prices non-negative).
- Numbering is sequential and never reuses a number, even after deletes.
- The app must start and work with no internet connection.
- Include a `README.md` covering how to run in dev, run tests, build installers, where data lives, and how to back up and restore.
- At the end of each phase, give me a short summary: what was built, what to test by hand, and any decisions you made.

---

## 8. Out of scope (for now; note as future ideas in `docs/FUTURE.md`)
- Online customer portal / online approval links (would need hosting)
- Accepting card payments in-app (Stripe/Square)
- Live supplier catalog/inventory APIs (S&S, SanMar)
- QuickBooks sync
- Multi-user / network sync
- Simulated process, index, and CMYK separations from raster/photographic art
- Driving a film printer directly / RIP features (ink density control, dot gain curves)

Start by reading this whole document, then write `docs/PLAN.md` and show it to me before beginning Phase 1.
