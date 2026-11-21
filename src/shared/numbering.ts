/** Document numbers and file names. */

export function formatDocNumber(prefix: string, n: number, revision = 1): string {
  const base = `${prefix}${n}`
  return revision > 1 ? `${base}-R${revision}` : base
}

/** Make a string safe and short for a file name: "Joe's Pizza & Co." → "Joes_Pizza_Co" */
export function fileSafe(s: string | null | undefined, max = 40): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, max)
    .replace(/[_-]+$/, '')
}

export function documentFileName(parts: Array<string | null | undefined>): string {
  return parts.map((p) => fileSafe(p)).filter(Boolean).join('_') + '.pdf'
}
