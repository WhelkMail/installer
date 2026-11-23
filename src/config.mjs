import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { InstallerError } from './errors.mjs'

function quote(value) {
  const text = String(value)
  if (/["\r\n]/.test(text)) {
    throw new InstallerError(`Unsupported character in configuration value: ${text}`)
  }
  return `"${text}"`
}

/**
 * Pages uses the standard root `wrangler.jsonc`, the same file the Workers
 * target and the Deploy to Cloudflare button read. Build a Pages-only config
 * here: no `main`/`assets`, just the build output directory and bindings.
 */
export function buildPagesConfig({ projectName, dbName, dbId, r2Bucket = null }) {
  const config = {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: projectName,
    compatibility_date: '2026-11-01',
    pages_build_output_dir: './dist',
    d1_databases: [
      {
        binding: 'DB',
        database_name: dbName,
        database_id: dbId,
      },
    ],
  }

  if (r2Bucket) {
    config.r2_buckets = [{ binding: 'BUCKET', bucket_name: r2Bucket }]
  }

  return `${JSON.stringify(config, null, 2)}\n`
}

export function writePagesConfig(sourceDir, config) {
  const target = join(sourceDir, 'wrangler.jsonc')
  writeFileSync(target, config)

  // Pages reads the standard root config and rejects a second legacy file.
  const legacy = join(sourceDir, 'wrangler.toml')
  if (existsSync(legacy)) {
    rmSync(legacy, { force: true })
  }

  return target
}

export function ensureWorkerConfig(sourceDir, { projectName, appUrl }) {
  const target = join(sourceDir, 'worker', 'wrangler.toml')
  const template = join(sourceDir, 'worker', 'wrangler.toml.example')
  if (!existsSync(template) && !existsSync(target)) {
    throw new InstallerError('Missing worker/wrangler.toml.example in the WhelkMail source')
  }

  let text = readFileSync(existsSync(target) ? target : template, 'utf8')
  const workerName = `${projectName}-cron`.slice(0, 63)

  text = /^name\s*=.*$/m.test(text)
    ? text.replace(/^name\s*=.*$/m, `name = ${quote(workerName)}`)
    : `name = ${quote(workerName)}\n${text}`

  const appUrlLine = `APP_URL = ${quote(appUrl)}`
  if (/^APP_URL\s*=.*$/m.test(text)) {
    text = text.replace(/^APP_URL\s*=.*$/m, appUrlLine)
  } else if (/^\[vars\]\s*$/m.test(text)) {
    text = text.replace(/^\[vars\]\s*$/m, `[vars]\n${appUrlLine}`)
  } else {
    text = `${text.trimEnd()}\n\n[vars]\n${appUrlLine}\n`
  }

  writeFileSync(target, text)
  return target
}
