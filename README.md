# Inkwell

A local-first desktop app for screen printing and custom apparel shops: build accurate quotes
fast, turn approved quotes into invoices, track payments, and send professional PDFs. Everything
stays on your computer and works without an internet connection.

**Status:** Phases 1 and 2 of 5 are done: setup wizard, customers, garment catalog with CSV
import, pricing matrices and rules (including margin-based markup), fee presets, ink library,
settings, backups, and the quote builder with live pricing, revisions and quote PDFs. Invoices
and payments arrive in Phase 3. See [`docs/PLAN.md`](docs/PLAN.md) for the full checklist.

## Building a quote

**Quotes → New quote** (or Ctrl/Cmd+N). Pick or add the customer, add a line item (search your
catalog, or choose a custom or customer-supplied item), pick the color, type quantities into the
size grid, and add imprints. Prices update as you type and the quote saves itself. Open
**Pricing breakdown** on a line to see exactly how each unit price was built (internal only) or
to set a price by hand. **Duplicate** a line to put the same design on another color; lines with
identical imprints share quantity breaks and screens.

**Preview** shows the customer's view. **Save PDF** / **Open PDF** export it. **Mark as sent**
locks the prices; to change a sent quote use **Revise**, which makes `Q-1001-R2` and keeps the
original. **Reorder this job** copies a past quote with screens marked as on file.

## Run it

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

`npm run dev` starts the app with hot reload. `npm run build && npm start` runs the production build.

## Tests

```bash
npm test            # unit tests (money, numbering, CSV import, pricing engine, quotes, database, backups)
npm run typecheck   # TypeScript, main + renderer
npm run test:e2e    # builds, then drives the real app with Playwright
```

On a Linux machine without a display, run the end-to-end tests under Xvfb:
`xvfb-run -a npm run test:e2e`.

## Build installers

```bash
npm run dist:win    # Windows .exe installer (NSIS), in dist/
npm run dist:mac    # macOS .dmg, in dist/ (must be run on a Mac)
```

The installers are not code-signed, so Windows SmartScreen and macOS Gatekeeper will warn the
first time. On Windows choose **More info → Run anyway**; on macOS right-click the app and
choose **Open**. Signing needs paid certificates and is not set up.

## Where your data lives

Everything is in the app’s data folder (Settings → About shows the exact path, and
**Help → Open Data Folder** opens it):

| OS | Folder |
|---|---|
| Windows | `%APPDATA%\Inkwell` |
| macOS | `~/Library/Application Support/Inkwell` |
| Linux | `~/.config/Inkwell` |

Inside it:

- `inkwell.db`: the database (SQLite)
- `attachments/`: your logo, tax certificates, and later mockups and artwork
- `backups/`: automatic and manual backups
- `pdfs/`: a copy of every PDF you generate

## Backups and restore

- Inkwell backs up the database automatically once a day (on launch, and every 24 hours while
  running) and keeps the newest 30 in `backups/`.
- **Settings → Backups → Back up now** makes one immediately.
- **Restore** (from the list, or **Restore from file…** for a backup you copied elsewhere)
  checks the file, saves a `before-restore` backup of your current data, swaps the database and
  restarts the app. Nothing is lost if you restore the wrong one: restore the `before-restore` copy.
- Backups contain the database only. To keep attachments too, copy the whole data folder.
- For off-computer safety, copy the `backups/` folder to a USB drive or a synced cloud folder
  now and then.

## Project layout

```
src/shared/     pure TypeScript shared by both processes: money, sizes, schemas, IPC contract, pricing
src/main/       Electron main process: database, migrations, repositories, IPC handlers, backups, files
src/preload/    the bridge that exposes typed IPC to the UI
src/renderer/   React UI
test/unit/      database and backup tests     test/e2e/   Playwright tests against the built app
docs/           build prompt, plan and checklist, decisions, future ideas
```

Money is always stored as integer cents and rates as integer basis points (825 = 8.25%).
Database changes go in a new numbered file in `src/main/db/migrations/`; never edit one that
has shipped.
