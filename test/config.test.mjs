import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPagesConfig, ensureWorkerConfig, writePagesConfig } from '../src/config.mjs'

test('pages config contains the D1 binding', () => {
  const config = JSON.parse(
    buildPagesConfig({
      projectName: 'whelkmail',
      dbName: 'mail-client',
      dbId: '11111111-2222-3333-4444-555555555555',
    }),
  )
  assert.equal(config.name, 'whelkmail')
  assert.equal(config.pages_build_output_dir, './dist')
  assert.deepEqual(config.d1_databases, [
    {
      binding: 'DB',
      database_name: 'mail-client',
      database_id: '11111111-2222-3333-4444-555555555555',
    },
  ])
  assert.equal(config.r2_buckets, undefined)
  assert.equal(config.main, undefined)
  assert.equal(config.assets, undefined)
})

test('pages config adds the R2 binding when requested', () => {
  const config = JSON.parse(
    buildPagesConfig({
      projectName: 'whelkmail',
      dbName: 'mail-client',
      dbId: 'id',
      r2Bucket: 'whelkmail-archive',
    }),
  )
  assert.deepEqual(config.r2_buckets, [
    { binding: 'BUCKET', bucket_name: 'whelkmail-archive' },
  ])
})

test('writePagesConfig writes wrangler.jsonc and removes a legacy wrangler.toml', () => {
  const dir = mkdtempSync(join(tmpdir(), 'whelkmail-config-'))
  try {
    writeFileSync(join(dir, 'wrangler.toml'), 'name = "legacy"\n')
    const target = writePagesConfig(
      dir,
      buildPagesConfig({ projectName: 'demo', dbName: 'mail-client', dbId: 'id' }),
    )

    assert.equal(target, join(dir, 'wrangler.jsonc'))
    assert.equal(existsSync(join(dir, 'wrangler.toml')), false)
    assert.equal(JSON.parse(readFileSync(target, 'utf8')).name, 'demo')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('worker config gets the project name and APP_URL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'whelkmail-config-'))
  try {
    mkdirSync(join(dir, 'worker'), { recursive: true })
    writeFileSync(
      join(dir, 'worker', 'wrangler.toml.example'),
      [
        'name = "whelkmail-cron"',
        'main = "index.ts"',
        'compatibility_date = "2026-11-01"',
        '',
        '[vars]',
        'APP_URL = ""',
        '',
      ].join('\n'),
    )

    const target = ensureWorkerConfig(dir, {
      projectName: 'demo',
      appUrl: 'https://demo.pages.dev',
    })
    const text = readFileSync(target, 'utf8')

    assert.match(text, /^name = "demo-cron"$/m)
    assert.match(text, /^APP_URL = "https:\/\/demo\.pages\.dev"$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
