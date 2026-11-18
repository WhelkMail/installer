import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { InstallerError } from './errors.mjs'

function quote(value) {
  const text = String(value)
  if (/["\r\n]/.test(text)) {
    throw new InstallerError(`Unsupported character in configuration value: ${text}`)
  }
  return `"${text}"`
}

export function buildPagesConfig({ projectName, dbName, dbId, r2Bucket = null }) {
  const lines = [
    `name = ${quote(projectName)}`,
    'compatibility_date = "2026-11-01"',
    'pages_build_output_dir = "./dist"',
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    `database_name = ${quote(dbName)}`,
    `database_id = ${quote(dbId)}`,
    '',
  ]

  if (r2Bucket) {
    lines.push('[[r2_buckets]]', 'binding = "BUCKET"', `bucket_name = ${quote(r2Bucket)}`, '')
  }

  return lines.join('\n')
}

export function writePagesConfig(sourceDir, config) {
  const target = join(sourceDir, 'wrangler.toml')
  writeFileSync(target, config)
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
