import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { API_METHODS, channel, type MainEvent } from '../shared/ipc'

// Each method resolves to an IpcResult ({ ok, data } | { ok: false, error }). The renderer's
// lib/api.ts unwraps it and throws a typed ApiError. Errors are passed as data because
// contextBridge strips custom properties (like per-field messages) from thrown errors.
const raw: Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>> = {}
for (const [domain, methods] of Object.entries(API_METHODS)) {
  raw[domain] = {}
  for (const method of Object.keys(methods)) {
    raw[domain][method] = (...args: unknown[]) => ipcRenderer.invoke(channel(domain, method), ...args)
  }
}

contextBridge.exposeInMainWorld('rawApi', raw)
contextBridge.exposeInMainWorld('events', {
  on(cb: (e: MainEvent) => void): () => void {
    const listener = (_: unknown, e: MainEvent) => cb(e)
    ipcRenderer.on('main-event', listener)
    return () => ipcRenderer.removeListener('main-event', listener)
  }
})

// Paths of files dropped on the window (drag and drop of mockups and artwork).
contextBridge.exposeInMainWorld('files', { pathFor: (file: File) => webUtils.getPathForFile(file) })
