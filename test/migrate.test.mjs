import test from 'node:test'
import assert from 'node:assert/strict'
import { planMigrations, netRequirements } from '../src/migrate.mjs'

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

test('tables dropped by a later migration are not required', () => {
  const requirements = netRequirements([
    {
      file: '009_forward_and_delete.sql',
      sql: 'CREATE TABLE IF NOT EXISTS forward_rules (id TEXT);',
      requirements: [{ kind: 'table', name: 'forward_rules' }],
    },
    {
      file: '011_filter_forwarding.sql',
      sql: 'DROP TABLE IF EXISTS forward_rules;',
      requirements: [],
    },
  ])
  assert.deepEqual(requirements, [])
})

test('indexes on a dropped table are gone, recreated indexes are required', () => {
  const requirements = netRequirements([
    {
      file: '009_forward_and_delete.sql',
      sql: [
        'CREATE TABLE IF NOT EXISTS forward_log (id TEXT);',
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_forward_log_unique ON forward_log (rule_id, message_id);',
        'CREATE INDEX IF NOT EXISTS idx_forward_log_rule ON forward_log (rule_id);',
      ].join('\n'),
      requirements: [
        { kind: 'table', name: 'forward_log' },
        { kind: 'index', name: 'idx_forward_log_unique', unique: true },
        { kind: 'index', name: 'idx_forward_log_rule', unique: false },
      ],
    },
    {
      file: '011_filter_forwarding.sql',
      sql: [
        'DROP TABLE IF EXISTS forward_log;',
        'CREATE TABLE IF NOT EXISTS forward_log (id TEXT);',
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_forward_log_unique ON forward_log (filter_id, message_id);',
      ].join('\n'),
      requirements: [
        { kind: 'table', name: 'forward_log' },
        { kind: 'index', name: 'idx_forward_log_unique', unique: true },
      ],
    },
  ])
  const names = requirements.map((entry) => `${entry.item.kind}:${entry.item.name}`)
  assert.deepEqual(names.sort(), ['index:idx_forward_log_unique', 'table:forward_log'])
})

test('columns are dropped together with their table', () => {
  const requirements = netRequirements([
    {
      file: '009_forward_and_delete.sql',
      sql: 'ALTER TABLE old_accounts ADD COLUMN delete_after_archive INTEGER;',
      requirements: [{ kind: 'column', table: 'old_accounts', name: 'delete_after_archive' }],
    },
    {
      file: '011_filter_forwarding.sql',
      sql: 'DROP TABLE IF EXISTS old_accounts;',
      requirements: [],
    },
  ])
  assert.deepEqual(requirements, [])
})
