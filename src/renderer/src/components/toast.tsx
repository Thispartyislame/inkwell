import { CheckCircle2, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { errorMessage } from '../lib/api'

interface Toast {
  id: number
  tone: 'success' | 'error'
  text: string
}
interface ToastApi {
  success(text: string): void
  error(e: unknown): void
}

const Ctx = createContext<ToastApi>({ success: () => {}, error: () => {} })
export const useToast = () => useContext(Ctx)

let nextId = 1
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = nextId++
    setToasts((t) => [...t, { id, tone, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3000)
  }, [])
  const api: ToastApi = {
    success: (text) => push('success', text),
    error: (e) => push('error', errorMessage(e))
  }
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col items-end gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useAsync() {
  const toast = useToast()
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn()
        if (success) toast.success(success)
        return r
      } catch (e) {
        toast.error(e)
        return undefined
      }
    },
    [toast]
  )
}
