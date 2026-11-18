import test from 'node:test'
import assert from 'node:assert/strict'
import { planMigrations } from '../src/migrate.mjs'

const files = ['001_one.sql', '002_two.sql', '003_three.sql']

test('fresh database records every migration', () => {
  const plan = planMigrations({ fresh: true, applied: new Set(), files })
  assert.equal(plan.mode, 'record')
  assert.deepEqual(plan.pending, files)
})

test('pre-registry database records every migration', () => {
  const plan = planMigrations({ fresh: false, applied: new Set(), files })
  assert.equal(plan.mode, 'record')
  assert.deepEqual(plan.pending, files)
})

test('existing database applies only pending migrations', () => {
  const plan = planMigrations({
    fresh: false,
    applied: new Set(['001_one.sql']),
    files,
  })
  assert.equal(plan.mode, 'apply')
  assert.deepEqual(plan.pending, ['002_two.sql', '003_three.sql'])
})

test('nothing to do when everything is recorded', () => {
  const plan = planMigrations({ fresh: false, applied: new Set(files), files })
  assert.equal(plan.mode, 'none')
  assert.deepEqual(plan.pending, [])
})
