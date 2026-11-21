import { useEffect } from 'react'
import { luminance } from '@shared/colors'
import type { Settings } from '@shared/schemas'

/** Apply light/dark/system theme and the accent color from settings. */
export function useTheme(settings: Pick<Settings, 'theme' | 'accent_color'> | undefined) {
  const theme = settings?.theme ?? 'system'
  const accent = settings?.accent_color ?? '#2563eb'
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches))
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--accent', accent)
    root.setProperty('--accent-fg', luminance(accent) > 0.45 ? '#0f172a' : '#ffffff')
  }, [accent])
}
