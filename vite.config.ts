import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  test: {
    // `tests/` holds Playwright end-to-end specs, which only Playwright can run.
    // Vitest's default `include` matches `*.spec.js` anywhere, so without this it
    // loads `tests/mobile.spec.js`, `@playwright/test` throws "Playwright Test did
    // not expect test() to be called here", and `npm test` exits 1 even on a clean
    // main.
    exclude: [...configDefaults.exclude, 'tests/**'],
  },
})
