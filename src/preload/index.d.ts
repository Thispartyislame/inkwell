import type { IpcResult, MainEvent } from '../shared/ipc'

declare global {
  interface Window {
    rawApi: Record<string, Record<string, (...a: unknown[]) => Promise<IpcResult<unknown>>>>
    events: { on(cb: (e: MainEvent) => void): () => void }
    files: { pathFor(file: File): string }
    pdfBridge?: { payload(): Promise<unknown>; ready(): void }
  }
}
export {}
