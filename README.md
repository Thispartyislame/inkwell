# Inkwell

A local-first desktop app for screen printing and custom apparel shops: build accurate quotes
fast, turn approved quotes into invoices, track payments, and send professional PDFs. Everything
stays on your computer and works without an internet connection.

**Status:** all five phases are built: setup wizard, customers, garment catalog with CSV
import, pricing matrices and rules (including margin-based markup), the quote builder with live
pricing, revisions and PDFs, invoices with deposits, payments, receipts and email, the
dashboard, reports, the production board, the combined garment order list, spot-color
separations with film output, and installers for Windows and macOS. See
[`docs/PLAN.md`](docs/PLAN.md) for the full checklist.

## Everyday shortcuts

| Keys | Does |
|---|---|
| Ctrl/Cmd+K | Command palette: jump anywhere, run an action, or search any record |
| Ctrl/Cmd+N | New quote |
| Ctrl/Cmd+P | Open the PDF of the quote or invoice you're looking at |
| Ctrl/Cmd+1…8 | Dashboard, Quotes, Invoices, Production, Customers, Catalog, Pricing, Reports |

## Production and ordering blanks

Approving a quote puts the job on **Production** at "Awaiting art"; drag cards along as the
job moves (the stage follows the job onto its invoice). **Garment order list** combines the
blanks for the jobs you pick into one order per supplier, by style, color and size, with an
estimated cost. Export it as CSV or PDF for your distributor, then **Mark as ordered**.

## Separations (film positives)

**Separations → Open artwork** (or the layers button on an SVG/PDF/AI file under a quote's
*Mockups & artwork*). Inkwell reads the vector art, lists every color with how much of the
design it covers, and builds one film per screen:

1. Pick the **garment color**. Colors that match the shirt drop out, and dark garments get a
   white **underbase** (choked so it doesn't peek out).
2. **Merge** near-identical colors (tolerance slider) or merge by hand; mark colors **Don't
   print**; assign inks from your ink library.
3. Set the **print order** (drag), **overprint** colors that should print on top, and a
   **trap** spread.
4. Gradients and see-through fills become **halftones** (beta: check the film).
5. Check the **composite** and **film view**, then **Save films PDF** (one page per screen,
   100% size, registration and center marks, label), one PDF per screen, or PNGs.
6. **Link to imprint** sets that imprint's color count and underbase (with a "From
   separations" badge), so the screen fee is right.

Works from **spot-color vector art**. Live text must be outlined first, embedded photos are
left off (and mostly-photo art is refused), and EPS needs Inkscape or Ghostscript installed.
Process / CMYK separations from photos are out of scope.

## Reports

**Reports** has sales by month or quarter, sales by customer, sales tax (taxable, exempt and
non-taxable sales and tax charged, for filing), payments by method, and quote win rate. Every
table exports to CSV for your accountant or spreadsheet.

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

## Invoices and payments

On an approved quote, **Convert to invoice** creates the invoice with the same lines and the
exact prices that were approved; any deposit you recorded on the quote (**Record deposit**)
comes along as a payment. Adjust final counts if needed, then **Email** or **Mark as sent**.
**Record payment** for each check, card or Venmo payment; the status moves to Partially paid
and Paid on its own, and unpaid invoices past their due date show as Overdue. Each payment has
a receipt PDF you can open or email.

**Email:** add your SMTP server under Settings → Email (for Gmail: `smtp.gmail.com`, port 587,
your address, and an [app password](https://support.google.com/accounts/answer/185833)), then
use **Send test**. Without SMTP, the Email button saves the PDF, opens its folder, and copies
the message so you can send it from your usual email program.

## Tests

```bash
npm test            # unit tests (money, CSV import, pricing engine, quotes, invoices, payments, backups)
npm run typecheck   # TypeScript, main + renderer
npm run test:e2e    # builds, then drives the real app with Playwright
```

On a Linux machine without a display, run the end-to-end tests under Xvfb:
`xvfb-run -a npm run test:e2e`. The SMTP test needs a secret store to save the password; it is
skipped when none is available. To include it on headless Linux, run inside a session with
GNOME Keyring: `dbus-run-session -- sh -c 'echo -n pw | gnome-keyring-daemon --unlock --components=secrets; XDG_CURRENT_DESKTOP=GNOME xvfb-run -a npm run test:e2e'`.

## Installers

**Automatic builds:** GitHub Actions builds the Windows installer, the macOS disk images
(Intel and Apple silicon) and a Linux AppImage. Every build also runs the type checks and
tests, installs and uninstalls the Windows app to prove both work, and mounts the macOS
images.

- **Any time:** on GitHub, open **Actions → Build installers → Run workflow**. The installers
  are attached to the run under *Artifacts*.
- **A release:** push a version tag (`git tag v0.5.0 && git push origin v0.5.0`). The same
  build runs and publishes a GitHub Release with the installers attached.

**Uninstalling**

- **Windows:** Settings → Apps → Inkwell → Uninstall (or Start menu → Inkwell → Uninstall).
  It asks whether to also delete your data in `%APPDATA%\Inkwell`; the answer is No unless
  you choose Yes, so reinstalling picks up where you left off.
- **macOS:** drag Inkwell from Applications to the Trash. Your data stays in
  `~/Library/Application Support/Inkwell`; delete that folder too to remove everything.
- **Linux:** delete the AppImage; data is in `~/.config/Inkwell`.

### Building by hand

Build each installer on its own operating system:

```bash
npm run dist:win    # on Windows: dist/Inkwell-<version>-win-x64.exe (NSIS installer)
```

```bash
npm run dist:mac    # on a Mac: dist/Inkwell-<version>-mac-x64.dmg and -arm64.dmg
```

```bash
npm run dist:linux  # on Linux: dist/Inkwell-<version>-linux-x86_64.AppImage
```

Building the Windows installer on Linux or macOS also works if Wine is installed. The installer
lets you choose the install folder, adds Start menu and desktop shortcuts, and never deletes
your data when uninstalling. The version number shows in Settings → About.

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
