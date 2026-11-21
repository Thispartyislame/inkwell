import { dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { todayIso } from '@shared/dates'
import { garmentOrderDocument } from '@shared/documents'
import { fileUrl } from '@shared/files'
import type { ApiImpl, ReportRange } from '@shared/ipc'
import { fileSafe } from '@shared/numbering'
import { NEEDS_GARMENTS } from '@shared/production'
import { UserError } from '../db/errors'
import * as production from '../db/repos/production'
import * as reports from '../db/repos/reports'
import { getSettings } from '../db/repos/settings'
import { renderPdf } from '../pdf/render'
import type { MainContext } from './handlers'

const DATE = /^\d{4}-\d{2}-\d{2}$/
function range(r: ReportRange): [string, string, 'month' | 'quarter'] {
  if (!r || !DATE.test(r.from) || !DATE.test(r.to)) throw new UserError('Pick a start and end date')
  if (r.from > r.to) throw new UserError('The start date is after the end date')
  return [r.from, r.to, r.by === 'quarter' ? 'quarter' : 'month']
}

export function createReportHandlers(ctx: MainContext): Pick<ApiImpl, 'reports' | 'production'> {
  const db = () => ctx.db
  return {
    reports: {
      dashboard: () => reports.dashboard(db(), todayIso()),
      sales: (r) => reports.salesByPeriod(db(), ...range(r)),
      byCustomer: (r) => reports.salesByCustomer(db(), ...(range(r).slice(0, 2) as [string, string])),
      salesTax: (r) => reports.salesTax(db(), ...range(r)),
      payments: (r) => reports.paymentsByMethod(db(), ...(range(r).slice(0, 2) as [string, string])),
      winRate: (r) => reports.winRate(db(), ...(range(r).slice(0, 2) as [string, string]), todayIso()),
      exportCsv: async (name, csv) => {
        const win = ctx.window()
        const opts: Electron.SaveDialogOptions = { title: 'Export CSV', defaultPath: `${fileSafe(name, 80) || 'report'}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] }
        const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
        if (r.canceled || !r.filePath) return null
        // BOM so Excel opens UTF-8 (e.g. “–”, accented names) correctly.
        fs.writeFileSync(r.filePath, '﻿' + csv, 'utf8')
        return r.filePath
      }
    },
    production: {
      board: () => production.boardJobs(db()),
      setStatus: (job, status) => production.setProductionStatus(db(), job, status),
      garmentOrder: (jobs) => production.garmentOrder(db(), jobs ?? []),
      garmentOrderPdf: async (jobs, mode) => {
        const today = todayIso()
        const s = getSettings(db())
        const doc = garmentOrderDocument(production.garmentOrder(db(), jobs ?? []), s, fileUrl(s.logo_path), today)
        const buffer = await renderPdf(doc)
        const name = `Garment_order_${today}.pdf`
        if (mode === 'save') {
          const win = ctx.window()
          const opts: Electron.SaveDialogOptions = { title: 'Save garment order', defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] }
          const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
          if (r.canceled || !r.filePath) return null
          fs.writeFileSync(r.filePath, buffer)
          return r.filePath
        }
        const dir = path.join(ctx.userData, 'pdfs')
        fs.mkdirSync(dir, { recursive: true })
        const file = path.join(dir, name)
        fs.writeFileSync(file, buffer)
        const err = await shell.openPath(file)
        if (err) throw new UserError(`The PDF was saved to ${file} but couldn’t be opened: ${err}`)
        return file
      },
      markOrdered: (jobs) =>
        db().transaction(() => {
          for (const j of jobs ?? []) {
            const row = db().prepare(`SELECT production_status FROM ${j.kind === 'quote' ? 'quotes' : 'invoices'} WHERE id = ?`).get(j.id) as { production_status: string | null } | undefined
            // Only move jobs forward: don't pull a job back from "in production".
            if (row && (row.production_status === null || (NEEDS_GARMENTS as string[]).includes(row.production_status))) production.setProductionStatus(db(), j, 'garments_ordered')
          }
        })()
    }
  }
}
