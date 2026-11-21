import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } }
  },
  preload: {
    resolve: { alias: shared },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts'), pdf: resolve(__dirname, 'src/preload/pdf.ts') } } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: [
        ...Object.entries({ ...shared, '@': resolve(__dirname, 'src/renderer/src') }).map(([find, replacement]) => ({ find, replacement })),
        // paper.js core build: no PaperScript compiler, so no eval (blocked by the app's CSP).
        // paperjs-offset imports 'paper' too, so both share this one copy.
        { find: /^paper$/, replacement: resolve(__dirname, 'node_modules/paper/dist/paper-core.js') }
      ]
    },
    plugins: [react(), tailwindcss()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html'), pdf: resolve(__dirname, 'src/renderer/pdf.html') } } }
  }
})
