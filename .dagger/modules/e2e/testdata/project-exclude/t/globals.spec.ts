import { afterEach, expect, test } from 'vitest'

// Like vuejs/core's webStream.spec.ts: tests that remove web globals must not
// break the reporter's span export.
afterEach(() => {
  delete (globalThis as any).ReadableStream
  delete (globalThis as any).fetch
})

test('removes globals', () => {
  expect(typeof ReadableStream).toBe('function')
})

test('exports spans after the globals are gone', async () => {
  // Long enough for the batch span processor to export in between.
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(1).toBe(1)
})
