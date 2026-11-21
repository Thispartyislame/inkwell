import { ipcMain } from 'electron'
import { API_METHODS, channel, type ApiImpl, type IpcResult } from '@shared/ipc'
import { UserError } from '../db/errors'

/** Register one ipcMain handler per API method. Errors come back as data, never as throws. */
export function registerIpc(impl: ApiImpl, isTrustedSender: (e: Electron.IpcMainInvokeEvent) => boolean): void {
  for (const [domain, methods] of Object.entries(API_METHODS)) {
    for (const method of Object.keys(methods)) {
      const fn = (impl as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[domain][method]
      ipcMain.handle(channel(domain, method), async (e, ...args): Promise<IpcResult<unknown>> => {
        if (!isTrustedSender(e)) return { ok: false, error: { message: 'Untrusted sender' } }
        try {
          return { ok: true, data: await fn(...args) }
        } catch (err) {
          if (err instanceof UserError) return { ok: false, error: { message: err.message, fields: err.fields } }
          console.error(`[ipc] ${domain}.${method} failed`, err)
          const msg = err instanceof Error ? err.message : String(err)
          return { ok: false, error: { message: `Something went wrong: ${msg}` } }
        }
      })
    }
  }
}
