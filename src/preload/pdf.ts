import { contextBridge, ipcRenderer } from 'electron'

// The hidden PDF window only gets its document and a way to say it's ready to print.
contextBridge.exposeInMainWorld('pdfBridge', {
  payload: () => ipcRenderer.invoke('pdf:payload'),
  ready: () => ipcRenderer.send('pdf:ready')
})
