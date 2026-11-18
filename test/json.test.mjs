import test from 'node:test'
import assert from 'node:assert/strict'
import { extractJson } from '../src/json.mjs'

test('extracts JSON surrounded by wrangler warnings and colors', () => {
  const output = [
    '\u001b[33m[wrangler] some warning\u001b[0m',
    '[{"uuid":"abc","name":"mail-client"}]',
    'done',
  ].join('\n')
  assert.deepEqual(extractJson(output), [{ uuid: 'abc', name: 'mail-client' }])
})

test('extracts a single object', () => {
  assert.deepEqual(extractJson('noise {"ok":true} noise'), { ok: true })
})

test('throws when there is no JSON', () => {
  assert.throws(() => extractJson('nothing here'))
})
