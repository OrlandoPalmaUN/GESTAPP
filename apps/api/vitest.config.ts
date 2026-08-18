import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Los tests son de integración contra la API y una base real: comparten un
    // único tenant descartable, así que NO pueden correr en paralelo.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['src/**/*.test.ts'],
  },
})
