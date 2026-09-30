import { expect, test } from 'vitest'
import { answer } from 'lib'
import { local } from 'local-dep'
test('workspace dependency', () => { expect(answer).toBe(42) })
test('file: dependency', () => { expect(local).toBe('copied') })
