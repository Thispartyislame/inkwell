import '@fontsource-variable/inter'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { CustomerDocument } from '@shared/documents'
import { DocumentView } from './pdf/DocumentView'
import './pdf/document.css'

/** Entry for the hidden window that prints documents to PDF. */
async function main() {
  const doc = (await window.pdfBridge!.payload()) as CustomerDocument | null
  if (!doc) return
  document.title = `${doc.title} ${doc.number}`
  document.body.classList.add('inkdoc-print')
  const root = createRoot(document.getElementById('root')!)
  flushSync(() => root.render(<DocumentView doc={doc} />))
  await document.fonts.ready
  await Promise.all(
    [...document.images].map((img) => (img.complete ? Promise.resolve() : new Promise((r) => ((img.onload = r), (img.onerror = r)))))
  )
  window.pdfBridge!.ready()
}
void main()
