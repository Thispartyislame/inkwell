import type Database from 'better-sqlite3'
import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ApiImpl } from '@shared/ipc'
import { backupDatabase, listBackups, validateBackup } from '../backup/backup'
import { UserError } from '../db/errors'
import { MIGRATIONS, schemaVersion } from '../db/migrate'
import { addAttachment, deleteAttachmentRow, findAttachment, getAttachment } from '../db/repos/attachments'
import {
  deleteContact,
  getCustomer,
  getCustomerDetail,
  listCustomers,
  listTags,
  saveContact,
  saveCustomer,
  setCustomerArchived,
  setCustomerCert
} from '../db/repos/customers'
import { duplicateGarment, getGarment, importGarments, listGarments, saveGarment, setGarmentArchived } from '../db/repos/garments'
import * as pricing from '../db/repos/pricing'
import { globalSearch } from '../db/repos/search'
import { completeSetup, getSettings, saveSettings, setLastBackupAt, setLogoPath, setSmtpPasswordEnc } from '../db/repos/settings'
import { removeStoredFile, resolveInside, storeFile } from '../files/files'
import { createDocumentHandlers } from './quotes'

export interface MainContext {
  db: Database.Database
  userData: string
  dbPath: string
  backupsDir: string
  window(): BrowserWindow | null
  /** close the DB, swap in a backup file and relaunch */
  restartWithDatabase(file: string): void
}

async function pickFile(ctx: MainContext, title: string, filters: Electron.FileFilter[]): Promise<string | null> {
  const win = ctx.window()
  const opts: Electron.OpenDialogOptions = { title, properties: ['openFile'], filters }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
}

export function createHandlers(ctx: MainContext): ApiImpl {
  const db = () => ctx.db

  const doBackup = async (label = '') => {
    const b = await backupDatabase(db(), ctx.backupsDir, label)
    setLastBackupAt(db(), new Date().toISOString())
    return b
  }

  const restoreFrom = async (file: string) => {
    validateBackup(file, MIGRATIONS[MIGRATIONS.length - 1].version)
    // Safety net: keep the current data before replacing it.
    await doBackup('before-restore')
    ctx.restartWithDatabase(file)
    return { restarting: true }
  }

  return {
    app: {
      info: () => ({
        version: app.getVersion(),
        electron: process.versions.electron,
        userDataPath: ctx.userData,
        dbPath: ctx.dbPath,
        schemaVersion: schemaVersion(db()),
        platform: process.platform
      }),
      openDataFolder: () => void shell.openPath(ctx.userData),
      openAttachment: async (id) => {
        const err = await shell.openPath(resolveInside(ctx.userData, getAttachment(db(), id).rel_path))
        if (err) throw new UserError(`Couldn’t open the file: ${err}`)
      },
      revealAttachment: (id) => shell.showItemInFolder(resolveInside(ctx.userData, getAttachment(db(), id).rel_path))
    },

    settings: {
      get: () => getSettings(db()),
      save: (input) => saveSettings(db(), input),
      completeSetup: (input) => completeSetup(db(), input),
      pickLogo: async () => {
        const src = await pickFile(ctx, 'Choose your logo', [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }])
        if (!src) return null
        if (fs.statSync(src).size > 10 * 1024 * 1024) throw new UserError('That image is over 10 MB. Use a smaller logo file.')
        const old = getSettings(db()).logo_path
        const stored = storeFile(ctx.userData, src, 'logo')
        const s = setLogoPath(db(), stored.rel_path)
        removeStoredFile(ctx.userData, old)
        return s
      },
      clearLogo: () => {
        const old = getSettings(db()).logo_path
        const s = setLogoPath(db(), null)
        removeStoredFile(ctx.userData, old)
        return s
      },
      setSmtpPassword: async (password) => {
        if (!password) return setSmtpPasswordEnc(db(), null)
        if (!(await safeStorage.isAsyncEncryptionAvailable()))
          throw new UserError('This computer has no secure password storage available, so the SMTP password can’t be saved safely.')
        return setSmtpPasswordEnc(db(), await safeStorage.encryptStringAsync(password))
      },
      encryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable()
    },

    customers: {
      list: (f) => listCustomers(db(), f ?? {}),
      get: (id) => getCustomerDetail(db(), id),
      save: (input) => saveCustomer(db(), input),
      archive: (id) => setCustomerArchived(db(), id, true),
      restore: (id) => setCustomerArchived(db(), id, false),
      tags: () => listTags(db()),
      saveContact: (input) => saveContact(db(), input),
      deleteContact: (id) => deleteContact(db(), id),
      attachCert: async (customerId) => {
        getCustomer(db(), customerId)
        const src = await pickFile(ctx, 'Choose the exemption certificate', [
          { name: 'Documents and images', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp'] }
        ])
        if (!src) return null
        const stored = storeFile(ctx.userData, src, `customers/${customerId}`)
        return db().transaction(() => {
          const old = findAttachment(db(), getCustomer(db(), customerId).exempt_cert_attachment_id)
          const att = addAttachment(db(), { owner_type: 'customer', owner_id: customerId, kind: 'tax_cert', ...stored })
          const c = setCustomerCert(db(), customerId, att.id)
          if (old) {
            deleteAttachmentRow(db(), old.id)
            removeStoredFile(ctx.userData, old.rel_path)
          }
          return c
        })()
      },
      removeCert: (customerId) =>
        db().transaction(() => {
          const old = findAttachment(db(), getCustomer(db(), customerId).exempt_cert_attachment_id)
          const c = setCustomerCert(db(), customerId, null)
          if (old) {
            deleteAttachmentRow(db(), old.id)
            removeStoredFile(ctx.userData, old.rel_path)
          }
          return c
        })()
    },

    garments: {
      list: (f) => listGarments(db(), f ?? {}),
      get: (id) => getGarment(db(), id),
      save: (input) => saveGarment(db(), input),
      duplicate: (id) => duplicateGarment(db(), id),
      archive: (id) => setGarmentArchived(db(), id, true),
      restore: (id) => setGarmentArchived(db(), id, false),
      pickCsv: async () => {
        const src = await pickFile(ctx, 'Import garments from CSV', [{ name: 'CSV', extensions: ['csv', 'txt'] }])
        if (!src) return null
        if (fs.statSync(src).size > 50 * 1024 * 1024) throw new UserError('That file is over 50 MB.')
        return { fileName: path.basename(src), text: fs.readFileSync(src, 'utf8').replace(/^﻿/, '') }
      },
      importRows: (rows, mode) => importGarments(db(), rows, mode)
    },

    pricing: {
      listMatrices: (all) => pricing.listMatrices(db(), all),
      getMatrix: (id) => pricing.getMatrix(db(), id),
      saveMatrix: (m) => pricing.saveMatrix(db(), m),
      duplicateMatrix: (id) => pricing.duplicateMatrix(db(), id),
      archiveMatrix: (id) => pricing.setMatrixArchived(db(), id, true),
      restoreMatrix: (id) => pricing.setMatrixArchived(db(), id, false),
      getRules: () => pricing.getRules(db()),
      saveRules: (r) => pricing.saveRules(db(), r),
      listFees: (all) => pricing.listFees(db(), all),
      saveFee: (f) => pricing.saveFee(db(), f),
      archiveFee: (id) => pricing.setFeeArchived(db(), id, true),
      restoreFee: (id) => pricing.setFeeArchived(db(), id, false),
      listInks: (all) => pricing.listInks(db(), all),
      saveInk: (k) => pricing.saveInk(db(), k),
      archiveInk: (id) => pricing.setInkArchived(db(), id, true),
      restoreInk: (id) => pricing.setInkArchived(db(), id, false)
    },

    backup: {
      list: () => listBackups(ctx.backupsDir),
      now: () => doBackup(),
      pickAndRestore: async () => {
        const file = await pickFile(ctx, 'Restore from backup', [{ name: 'Inkwell backup', extensions: ['db', 'sqlite'] }])
        return file ? restoreFrom(file) : null
      },
      restore: (file) => {
        // Only files from the backups folder can be restored by path.
        return restoreFrom(resolveInside(ctx.backupsDir, path.basename(file)))
      },
      reveal: () => {
        fs.mkdirSync(ctx.backupsDir, { recursive: true })
        void shell.openPath(ctx.backupsDir)
      }
    },

    search: {
      global: (q) => globalSearch(db(), q)
    },

    ...createDocumentHandlers(ctx)
  }
}

