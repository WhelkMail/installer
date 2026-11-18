import { appendFileSync } from 'node:fs'
import { install } from './install.mjs'
import { color, log } from './log.mjs'

export async function runInstaller(options) {
  const result = await install(options)
  if (!result.dryRun) {
    printSummary(result, options)
    if (options.isActions) {
      writeStepSummary(result, options)
    }
  }
  return result
}

function printSummary(result, options) {
  log.step('Installation complete')
  log.info(`URL:       ${result.url}`)
  log.info(`Project:   ${result.projectName}`)
  log.info(`Database:  ${result.dbName}`)
  log.info(`Version:   ${result.version}`)
  log.info(`R2:        ${result.r2Bucket ?? 'disabled'}`)
  log.info(`Cron:      ${result.cron ? 'enabled' : 'disabled'}`)
  log.info(`Web Push:  ${result.push ? 'enabled' : 'disabled'}`)
  if (result.tokenKeyFingerprint) {
    log.info(`TOKEN_ENC_KEY fingerprint: ${result.tokenKeyFingerprint.slice(0, 16)}...`)
  }

  if (result.generatedPassword) {
    log.warn(`APP_PASSWORD: ${result.generatedPassword}`)
  }
  if (result.generatedTokenKey) {
    log.warn(`TOKEN_ENC_KEY: ${result.generatedTokenKey}`)
  }
  if (result.generatedCronSecret) {
    log.warn(`CRON_SECRET: ${result.generatedCronSecret}`)
  }
  if (result.generatedPassword || result.generatedTokenKey || result.generatedCronSecret) {
    log.warn('Save the generated values now. They are not written to disk.')
  }

  log.raw('')
  log.raw(color.bold('Next steps'))
  log.raw(`  1. Open ${result.url}`)
  log.raw('  2. Sign in with APP_PASSWORD')
  log.raw('  3. Add your first account in Settings -> Accounts')
  log.raw('')
  log.raw(color.dim('IMAP note: Workers Free allows 10 ms CPU per request. IMAP/SMTP TLS'))
  log.raw(color.dim('handshakes can exceed it. Relay accounts over HTTP are the safest free path.'))
  log.raw(color.dim('Deployment guide: https://github.com/WhelkMail/WhelkMail/blob/main/docs/CLOUDFLARE.md'))
  log.raw(color.dim(`Account id: ${options.accountId ?? 'resolved by wrangler'}`))
}

export function writeStepSummary(result, options) {
  const file = process.env.GITHUB_STEP_SUMMARY
  if (!file) {
    return
  }
  const lines = [
    '## WhelkMail installed',
    '',
    `- URL: ${result.url}`,
    `- Project: ${result.projectName}`,
    `- D1 database: ${result.dbName}`,
    `- Version: ${result.version}`,
    `- R2: ${result.r2Bucket ?? 'disabled'}`,
    `- Cron: ${result.cron ? 'enabled' : 'disabled'}`,
    `- Web Push: ${result.push ? 'enabled' : 'disabled'}`,
    `- Account id: ${options.accountId ?? 'resolved by wrangler'}`,
    `- TOKEN_ENC_KEY fingerprint: \`${String(result.tokenKeyFingerprint ?? '').slice(0, 16)}...\``,
    '',
    'Sign in with the `APP_PASSWORD` repository secret.',
    '',
    'Workers Free allows 10 ms CPU per request; IMAP/SMTP TLS can exceed it.',
    '',
    'Revoke the Cloudflare API token used for this install once you are done.',
    '',
  ]
  appendFileSync(file, `${lines.join('\n')}\n`)
}
