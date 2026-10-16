import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Component specs live under src next to the code they cover; the browser
    // suite is separate (playwright.config.ts) because it needs a real layout
    // engine and, for the signed-in specs, a real Supabase project.
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
