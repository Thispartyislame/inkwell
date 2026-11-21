import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileSafe } from '@shared/numbering'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ai': 'application/postscript',
  '.eps': 'application/postscript',
  '.csv': 'text/csv',
  '.txt': 'text/plain'
}

export const mimeFor = (file: string) => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'

export interface StoredFile {
  rel_path: string
  original_name: string
  mime: string
  size_bytes: number
}

/** Copy a user-picked file into userData/attachments/<folder>/ under a unique name. */
export function storeFile(userData: string, src: string, folder: string): StoredFile {
  const ext = path.extname(src).toLowerCase()
  const base = fileSafe(path.basename(src, path.extname(src)), 60) || 'file'
  const rel = path.posix.join('attachments', folder, `${randomUUID().slice(0, 8)}-${base}${ext}`)
  const dest = resolveInside(userData, rel)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  return { rel_path: rel, original_name: path.basename(src), mime: mimeFor(src), size_bytes: fs.statSync(dest).size }
}

/** Resolve a relative path under root, refusing anything that escapes it. */
export function resolveInside(root: string, rel: string): string {
  const full = path.resolve(root, rel)
  const r = path.resolve(root)
  if (full !== r && !full.startsWith(r + path.sep)) throw new Error('Path is outside the data folder')
  return full
}

export function removeStoredFile(userData: string, rel: string | null): void {
  if (!rel) return
  try {
    fs.rmSync(resolveInside(userData, rel), { force: true })
  } catch {
    // a missing file is fine
  }
}
