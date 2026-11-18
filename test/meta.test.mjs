import test from 'node:test'
import assert from 'node:assert/strict'
import { generateTokenKey } from '../src/secrets.mjs'
import { fingerprintSecret, planTokenKey } from '../src/meta.mjs'

const stored = fingerprintSecret('stored-key')

test('fingerprints are stable sha256 hex digests', () => {
  assert.match(stored, /^[0-9a-f]{64}$/)
  assert.equal(fingerprintSecret('stored-key'), stored)
  assert.notEqual(fingerprintSecret('other-key'), stored)
})

test('a supplied key matching the deployment is used', () => {
  const plan = planTokenKey({ provided: 'stored-key', storedFingerprint: stored, fresh: false })
  assert.equal(plan.action, 'use')
  assert.equal(plan.fingerprint, stored)
})

test('surrounding whitespace does not change the fingerprint', () => {
  const plan = planTokenKey({
    provided: '  stored-key\n',
    storedFingerprint: stored,
    fresh: false,
  })
  assert.equal(plan.action, 'use')
  assert.equal(plan.fingerprint, stored)
})

test('a supplied key that does not match is rejected', () => {
  const plan = planTokenKey({ provided: 'other-key', storedFingerprint: stored, fresh: false })
  assert.equal(plan.action, 'mismatch')
  assert.equal(plan.storedFingerprint, stored)
})

test('a supplied key replaces the deployment only with rotation', () => {
  const plan = planTokenKey({
    provided: 'other-key',
    storedFingerprint: stored,
    fresh: false,
    rotate: true,
  })
  assert.equal(plan.action, 'use')
  assert.equal(plan.fingerprint, fingerprintSecret('other-key'))
})

test('fresh databases generate a key', () => {
  assert.equal(
    planTokenKey({ provided: undefined, storedFingerprint: null, fresh: true }).action,
    'generate',
  )
})

test('existing deployments never silently generate a key', () => {
  assert.equal(
    planTokenKey({ provided: undefined, storedFingerprint: stored, fresh: false }).action,
    'recover',
  )
  assert.equal(
    planTokenKey({ provided: undefined, storedFingerprint: null, fresh: false }).action,
    'unknown',
  )
  assert.equal(
    planTokenKey({
      provided: undefined,
      storedFingerprint: stored,
      fresh: false,
      rotate: true,
    }).action,
    'rotate',
  )
})

test('generated keys always produce a fingerprint', () => {
  const key = generateTokenKey()
  assert.equal(fingerprintSecret(key), fingerprintSecret(key))
})
