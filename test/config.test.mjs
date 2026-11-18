import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPagesConfig, ensureWorkerConfig } from '../src/config.mjs'

test('pages config contains the D1 binding', () => {
  const config = buildPagesConfig({
    projectName: 'whelkmail',
    dbName: 'mail-client',
    dbId: '11111111-2222-3333-4444-555555555555',
  })
  assert.match(config, /name = "whelkmail"/)
  assert.match(config, /pages_build_output_dir = "\.\/dist"/)
  assert.match(config, /binding = "DB"/)
  assert.match(config, /database_id = "11111111-2222-3333-4444-555555555555"/)
  assert.doesNotMatch(config, /\[\[r2_buckets\]\]/)
})

test('pages config adds the R2 binding when requested', () => {
  const config = buildPagesConfig({
    projectName: 'whelkmail',
    dbName: 'mail-client',
    dbId: 'id',
    r2Bucket: 'whelkmail-archive',
  })
  assert.match(config, /\[\[r2_buckets\]\]/)
  assert.match(config, /binding = "BUCKET"/)
  assert.match(config, /bucket_name = "whelkmail-archive"/)
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
