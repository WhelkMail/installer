import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generateCronSecret,
  generatePassword,
  generateTokenKey,
  validateTokenKey,
} from '../src/secrets.mjs'

test('generated token keys decode to 32 bytes', () => {
  for (let index = 0; index < 20; index += 1) {
    const key = generateTokenKey()
    assert.equal(Buffer.from(key, 'base64').length, 32)
    assert.equal(validateTokenKey(key), null)
  }
})

test('invalid token keys are rejected', () => {
  assert.match(validateTokenKey(''), /empty/)
  assert.match(validateTokenKey('dG9vLXNob3J0'), /32 random bytes/)
  assert.match(validateTokenKey('not base64 at all!'), /base64|32 random bytes/)
})

test('cron secrets are hex and unique', () => {
  const values = new Set()
  for (let index = 0; index < 20; index += 1) {
    const secret = generateCronSecret()
    assert.match(secret, /^[0-9a-f]{48}$/)
    values.add(secret)
  }
  assert.equal(values.size, 20)
})

test('generated passwords avoid ambiguous characters', () => {
  const password = generatePassword(64)
  assert.equal(password.length, 64)
  assert.doesNotMatch(password, /[lIO01]/)
})
