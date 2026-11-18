import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultOptions, parseArgs } from '../src/args.mjs'

test('defaults', () => {
  const { options, errors } = parseArgs([])
  assert.deepEqual(errors, [])
  assert.equal(options.projectName, 'whelkmail')
  assert.equal(options.dbName, 'mail-client')
  assert.equal(options.ref, 'latest')
  assert.equal(options.r2, false)
})

test('accepts equals and space separated values', () => {
  const { options, errors } = parseArgs([
    '--project-name=mail',
    '--db-name',
    'mail-db',
    '--ref=v1.0.1',
  ])
  assert.deepEqual(errors, [])
  assert.equal(options.projectName, 'mail')
  assert.equal(options.dbName, 'mail-db')
  assert.equal(options.ref, 'v1.0.1')
})

test('push implies cron and r2 bucket implies r2', () => {
  const { options } = parseArgs(['--push', '--r2-bucket', 'archive'])
  assert.equal(options.push, true)
  assert.equal(options.cron, true)
  assert.equal(options.r2, true)
  assert.equal(options.r2Bucket, 'archive')
})

test('r2 gets a default bucket name', () => {
  const { options } = parseArgs(['--r2', '--project-name', 'demo'])
  assert.equal(options.r2Bucket, 'demo-archive')
})

test('rejects unknown options and invalid names', () => {
  const { errors } = parseArgs(['--nope', '--project-name', 'Bad_Name'])
  assert.equal(errors.length, 2)
})

test('help is a boolean flag', () => {
  const { options } = parseArgs(['--help'])
  assert.equal(options.help, true)
})

test('token key rotation is opt-in', () => {
  assert.equal(parseArgs([]).options.rotateTokenKey, false)
  assert.equal(parseArgs(['--rotate-token-key']).options.rotateTokenKey, true)
})

test('defaults are not shared between calls', () => {
  const first = defaultOptions()
  const second = defaultOptions()
  first.source = 'x'
  assert.equal(second.source, null)
})
