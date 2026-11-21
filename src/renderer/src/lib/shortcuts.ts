import { useEffect, useRef } from 'react'

/** Ctrl/Cmd + key while this component is mounted (e.g. Ctrl+P on a quote opens its PDF). */
export function useShortcut(key: string, fn: () => void) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === key) {
        e.preventDefault()
        if (!e.repeat) ref.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key])
}
