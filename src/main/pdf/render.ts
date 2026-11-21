import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import type { CustomerDocument } from '@shared/documents'

/**
 * Render a document to a Letter-size PDF: load the same React template the in-app preview uses
 * into a hidden window, wait until fonts and images are ready, then print it.
 */
const payloads = new Map<number, CustomerDocument>()
const ready = new Map<number, () => void>()
let registered = false

function register() {
  if (registered) return
  registered = true
  ipcMain.handle('pdf:payload', (e) => payloads.get(e.sender.id) ?? null)
  ipcMain.on('pdf:ready', (e) => ready.get(e.sender.id)?.())
}

const FOOTER = `<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7.5px;color:#8a8f98;text-align:right;padding:0 0.5in;">
Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`

export async function renderPdf(doc: CustomerDocument): Promise<Buffer> {
  register()
  const win = new BrowserWindow({
    show: false,
    width: 816,
    height: 1056,
    webPreferences: { preload: path.join(__dirname, '../preload/pdf.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  const id = win.webContents.id
  payloads.set(id, doc)
  try {
    const isReady = new Promise<void>((resolve, reject) => {
      ready.set(id, resolve)
      setTimeout(() => reject(new Error('The PDF template took too long to load')), 20_000)
    })
    if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/pdf.html`)
    else await win.loadFile(path.join(__dirname, '../renderer/pdf.html'))
    await isReady
    return await win.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true,
      margins: { top: 0.5, bottom: 0.6, left: 0.5, right: 0.5 },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: FOOTER,
      preferCSSPageSize: false
    })
  } finally {
    payloads.delete(id)
    ready.delete(id)
    win.destroy()
  }
}
