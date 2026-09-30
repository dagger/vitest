import { expect, test } from 'vitest'
import { answer } from 'lib'
test('workspace dependency', () => { expect(answer).toBe(42) })
