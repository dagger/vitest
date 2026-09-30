import { execFileSync } from 'node:child_process'
import { expect, test } from 'vitest'

test('workspace package bin is linked', () => {
  const out = execFileSync('node_modules/.bin/lib-cli', { encoding: 'utf8' })
  expect(out.trim()).toBe('hello from lib-cli')
})
