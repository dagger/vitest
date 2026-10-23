import { describe, expect, test } from 'vitest'
describe('outer', () => {
  describe('inner', () => {
    test('adds (1+1)', () => { expect(1 + 1).toBe(2) })
  })
  test('plain', () => { expect(1).toBe(1) })
})
test('top', () => { expect(1).toBe(1) })
test('fails', () => { expect(1).toBe(2) })
test.skip('is skipped', () => { expect(1).toBe(2) })
