/** Garment color helpers: guess a swatch from a color name, decide light vs dark. */

const NAMED: Record<string, string> = {
  black: '#111111',
  white: '#ffffff',
  'natural': '#f3ead8',
  cream: '#f6efdc',
  ivory: '#f8f3e3',
  'ash': '#d9d9d6',
  'ash grey': '#d9d9d6',
  'sport grey': '#a7a8aa',
  'athletic heather': '#a7a8aa',
  'heather grey': '#b2b4b2',
  'heather gray': '#b2b4b2',
  grey: '#8d8d8d',
  gray: '#8d8d8d',
  silver: '#c4c4c4',
  'dark heather': '#4a4c4f',
  charcoal: '#4b4b4d',
  'graphite heather': '#55575b',
  navy: '#1f2a44',
  'true navy': '#1f2a44',
  'royal': '#2a4ea6',
  'royal blue': '#2a4ea6',
  'carolina blue': '#7ba4db',
  'light blue': '#a4c8e1',
  'sky': '#8ec5e8',
  'sapphire': '#0067a0',
  'indigo blue': '#3c5a7a',
  red: '#c8102e',
  cardinal: '#8a1538',
  'cardinal red': '#8a1538',
  maroon: '#5c1f2b',
  burgundy: '#6d1d2e',
  'cherry red': '#b31b34',
  orange: '#ff6a13',
  'safety orange': '#ff5f00',
  'texas orange': '#bf5700',
  gold: '#ffb81c',
  yellow: '#fbe122',
  'daisy': '#fed141',
  'safety green': '#c4d600',
  'lime': '#92d050',
  'kelly green': '#00843d',
  'irish green': '#00a651',
  'forest green': '#234a30',
  forest: '#234a30',
  'military green': '#5e6738',
  olive: '#5b5b31',
  'sand': '#d6c7a1',
  'khaki': '#c3b091',
  tan: '#c2a477',
  'brown': '#5d3a1a',
  'dark chocolate': '#3d2b1f',
  purple: '#4b2c7d',
  'light pink': '#f4c6d7',
  pink: '#f4a6c4',
  'azalea': '#ef74a8',
  'heliconia': '#e0457b',
  'teal': '#00827f',
  'jade dome': '#00857c',
  'turquoise': '#00a5b5',
  'mint': '#a9e3cf',
  'lavender': '#b6a6d6',
  'violet': '#7d55c7'
}

/** Best guess for a swatch hex from a color name ("Heather Navy" → navy). */
export function guessColorHex(name: string): string {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ')
  if (NAMED[n]) return NAMED[n]
  // Try the longest known name contained in the given one ("Vintage Heather Navy" → navy)
  let best: string | null = null
  for (const k of Object.keys(NAMED)) if (n.includes(k) && (!best || k.length > best.length)) best = k
  return best ? NAMED[best] : '#cccccc'
}

/** Relative luminance (WCAG). */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 1
  const v = parseInt(m[1], 16)
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/**
 * Whether a garment color is dark enough that ink printed on it typically needs a white
 * underbase. Threshold chosen so mid greys (sport grey) count as light, charcoal as dark.
 */
export function isDarkHex(hex: string): boolean {
  return luminance(hex) < 0.18
}

export function colorFromName(name: string): { name: string; hex: string; is_dark: boolean } {
  const hex = guessColorHex(name)
  return { name: name.trim(), hex, is_dark: isDarkHex(hex) }
}
