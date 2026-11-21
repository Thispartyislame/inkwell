import { API_METHODS, type RendererApi } from '@shared/ipc'

export class ApiError extends Error {
  constructor(
    message: string,
    public fields: Record<string, string> = {}
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function build(): RendererApi {
  const out: Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>> = {}
  for (const [domain, methods] of Object.entries(API_METHODS)) {
    out[domain] = {}
    for (const method of Object.keys(methods)) {
      out[domain][method] = async (...args: unknown[]) => {
        const r = await window.rawApi[domain][method](...args)
        if (r.ok) return r.data
        throw new ApiError(r.error.message, r.error.fields ?? {})
      }
    }
  }
  return out as unknown as RendererApi
}

/** Typed access to the main process: `await api.customers.list({})` */
export const api = build()

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))
export const fieldErrorsOf = (e: unknown): Record<string, string> => (e instanceof ApiError ? e.fields : {})

/** URL for a file stored under the data folder (logo, attachments). */
export const fileUrl = (relPath: string | null | undefined) => (relPath ? `inkwell-file://local/${relPath.split('/').map(encodeURIComponent).join('/')}` : '')
