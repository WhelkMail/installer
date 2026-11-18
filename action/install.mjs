import { envOptions } from '../src/env.mjs'
import { InstallerError, tail } from '../src/errors.mjs'
import { log, setVerbose } from '../src/log.mjs'
import { runInstaller } from '../src/run.mjs'

const env = process.env
const input = (name) => String(env[name] ?? '').trim()
const enabled = (name) => /^(1|true|yes|y|si)$/i.test(input(name))

const required = ['CLOUDFLARE_API_TOKEN', 'APP_PASSWORD', 'TOKEN_ENC_KEY']
const missing = required.filter((name) => !env[name])
if (missing.length > 0) {
  for (const name of missing) {
    console.log(`::error::Missing required secret: ${name}`)
  }
  process.exit(1)
}

const ref = input('REF') || 'latest'
if (ref !== 'latest' && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(ref)) {
  console.log('::error::Invalid ref input')
  process.exit(1)
}

const options = {
  ...envOptions(),
  isActions: true,
  yes: true,
  dryRun: false,
  keep: false,
  noHealth: false,
  verbose: true,
  source: null,
  ref,
  projectName: input('PROJECT_NAME') || 'whelkmail',
  dbName: input('DB_NAME') || 'mail-client',
  branch: input('BRANCH') || 'main',
  r2: enabled('ENABLE_R2'),
  r2Bucket: input('R2_BUCKET') || null,
  cron: enabled('DEPLOY_CRON') || enabled('ENABLE_PUSH'),
  push: enabled('ENABLE_PUSH'),
  pushSubject: input('PUSH_SUBJECT') || null,
}

if (options.r2 && !options.r2Bucket) {
  options.r2Bucket = `${options.projectName}-archive`
}

const NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/
const invalid = (message) => {
  console.log(`::error::${message}`)
  process.exit(1)
}
if (!NAME.test(options.projectName)) {
  invalid('project_name must be lowercase letters, digits and dashes')
}
if (!NAME.test(options.dbName)) {
  invalid('db_name must be lowercase letters, digits and dashes')
}
if (!/^[A-Za-z0-9._/-]{1,200}$/.test(options.branch)) {
  invalid('branch contains unsupported characters')
}
if (options.r2 && !BUCKET.test(options.r2Bucket)) {
  invalid('r2_bucket must be 3-63 lowercase characters, digits and dashes')
}
if (options.cron && !options.cronSecret) {
  invalid('CRON_SECRET is required when cron or push is enabled')
}

setVerbose(true)
log.banner()

try {
  const result = await runInstaller(options)
  console.log(`::notice::WhelkMail deployed at ${result.url}`)
} catch (error) {
  const message = error instanceof InstallerError ? error.message : String(error?.message ?? error)
  const hint = error?.hint || error?.output || ''
  console.log(`::error::${escapeCommand(message)}`)
  if (hint) {
    console.log(tail(hint))
  }
  if (error?.stack) {
    console.error(error.stack)
  }
  process.exitCode = 1
}

function escapeCommand(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
}
