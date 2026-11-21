import { app, BrowserWindow, Menu, nativeTheme, net, protocol, shell, type MenuItemConstructorOptions } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type Database from 'better-sqlite3'
import type { MainEvent } from '@shared/ipc'
import { backupIsDue, backupDatabase, replaceDatabaseFile } from './backup/backup'
import { openDatabase } from './db/connection'
import { expireQuotes } from './db/repos/quotes'
import { getSettings, setLastBackupAt } from './db/repos/settings'
import { todayIso } from '@shared/dates'
import { resolveInside } from './files/files'
import { createHandlers, type MainContext } from './ipc/handlers'
import { registerIpc } from './ipc/register'

// Tests (and power users) can point the app at a different data folder.
if (process.env.INKWELL_USER_DATA) app.setPath('userData', path.resolve(process.env.INKWELL_USER_DATA))

const userData = app.getPath('userData')
const dbPath = path.join(userData, 'inkwell.db')
const backupsDir = path.join(userData, 'backups')
const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL

// Files under the data folder (logo, attachments) are served to the UI via inkwell-file://
protocol.registerSchemesAsPrivileged([{ scheme: 'inkwell-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  let db: Database.Database

  const send = (e: MainEvent) => mainWindow?.webContents.send('main-event', e)

  const runScheduledBackup = async () => {
    try {
      if (!backupIsDue(getSettings(db).last_backup_at)) return
      const b = await backupDatabase(db, backupsDir)
      setLastBackupAt(db, new Date().toISOString())
      send({ type: 'backup-done', backup: b })
    } catch (err) {
      console.error('[backup] scheduled backup failed', err)
    }
  }

  const createWindow = () => {
    mainWindow = new BrowserWindow({
      width: 1360,
      height: 880,
      minWidth: 1024,
      minHeight: 640,
      show: false,
      title: 'Inkwell',
      // Windows and macOS take the icon from the installer; Linux needs it on the window.
      ...(process.platform === 'linux' ? { icon: path.join(__dirname, '../../resources/icon.png') } : {}),
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#f8fafc',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true
      }
    })
    mainWindow.once('ready-to-show', () => mainWindow?.show())
    mainWindow.on('closed', () => (mainWindow = null))
    // Never navigate the app window away, never open new windows; http(s) links go to the browser.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    mainWindow.webContents.on('will-navigate', (e, url) => {
      if (url !== mainWindow?.webContents.getURL()) e.preventDefault()
    })
    if (isDev) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!)
    else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  const buildMenu = () => {
    const nav = (to: string) => () => send({ type: 'navigate', to })
    const template: MenuItemConstructorOptions[] = [
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      {
        label: 'File',
        submenu: [
          // The window handles Ctrl/Cmd+N itself; the menu only shows the shortcut (avoids firing twice).
          { label: 'New Quote', accelerator: 'CmdOrCtrl+N', registerAccelerator: false, click: () => send({ type: 'new-quote' }) },
          { label: 'New Customer', click: nav('/customers/new') },
          { label: 'New Garment', click: nav('/catalog/new') },
          { type: 'separator' },
          { label: 'Command Palette…', accelerator: 'CmdOrCtrl+K', registerAccelerator: false, click: () => send({ type: 'command-palette' }) },
          { label: 'Open PDF (on a quote or invoice)', accelerator: 'CmdOrCtrl+P', registerAccelerator: false, enabled: false },
          { type: 'separator' },
          { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: nav('/settings') },
          { label: 'Backups', click: nav('/settings/backups') },
          { type: 'separator' },
          process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
        ]
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: 'Dashboard', accelerator: 'CmdOrCtrl+1', click: nav('/') },
          { label: 'Quotes', accelerator: 'CmdOrCtrl+2', click: nav('/quotes') },
          { label: 'Invoices', accelerator: 'CmdOrCtrl+3', click: nav('/invoices') },
          { label: 'Production', accelerator: 'CmdOrCtrl+4', click: nav('/production') },
          { label: 'Customers', accelerator: 'CmdOrCtrl+5', click: nav('/customers') },
          { label: 'Catalog', accelerator: 'CmdOrCtrl+6', click: nav('/catalog') },
          { label: 'Pricing', accelerator: 'CmdOrCtrl+7', click: nav('/pricing') },
          { label: 'Reports', accelerator: 'CmdOrCtrl+8', click: nav('/reports') },
          { type: 'separator' },
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'togglefullscreen' }
        ]
      },
      { role: 'windowMenu' },
      { role: 'help', submenu: [{ label: 'Open Data Folder', click: () => void shell.openPath(userData) }] }
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    fs.mkdirSync(userData, { recursive: true })
    db = openDatabase(dbPath)

    protocol.handle('inkwell-file', (req) => {
      try {
        const u = new URL(req.url)
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '')
        if (!rel.startsWith('attachments/')) return new Response('Not found', { status: 404 })
        return net.fetch(pathToFileURL(resolveInside(userData, rel)).toString())
      } catch {
        return new Response('Not found', { status: 404 })
      }
    })

    const ctx: MainContext = {
      get db() {
        return db
      },
      userData,
      dbPath,
      backupsDir,
      window: () => mainWindow,
      restartWithDatabase: (file) => {
        db.close()
        replaceDatabaseFile(file, dbPath)
        app.relaunch()
        app.exit(0)
      }
    }
    registerIpc(createHandlers(ctx), (e) => {
      const url = e.senderFrame?.url ?? ''
      return url.startsWith('file://') || (isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL!))
    })
    buildMenu()
    createWindow()

    const hourly = () => {
      void runScheduledBackup()
      try {
        expireQuotes(db, todayIso())
      } catch (err) {
        console.error('[quotes] expiry sweep failed', err)
      }
    }
    hourly()
    setInterval(hourly, 60 * 60 * 1000).unref()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    try {
      db?.close()
    } catch {
      // already closed (restore)
    }
  })
}
