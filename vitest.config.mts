import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: { include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'], environment: 'node' }
})
