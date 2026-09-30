import { expect, test } from 'vitest'
test('env', () => { expect(process.env.DAGGER_VITEST_E2E).toBe('yes') })
