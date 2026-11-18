import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildPagesConfig, ensureWorkerConfig, writePagesConfig } from './config.mjs'
import { InstallerError, tail } from './errors.mjs'
import { npmCommand, run } from './exec.mjs'
import { log } from './log.mjs'
import {
  fingerprintSecret,
  planTokenKey,
  readInstallerMeta,
  writeInstallerMeta,
} from './meta.mjs'
import { initialiseDatabase } from './migrate.mjs'
import {
  generateCronSecret,
  generatePassword,
  generateTokenKey,
  validateTokenKey,
} from './secrets.mjs'
import { askSecret } from './prompt.mjs'
import { createWorkspace, prepareSource, validateSource } from './source.mjs'
import { Wrangler } from './wrangler.mjs'

export async function install(options) {
  const major = Number(process.versions.node.split('.')[0])
  if (major < 22) {
    throw new InstallerError(`Node.js 22 or newer is required (found ${process.version})`)
  }

  if (options.dryRun) {
    printPlan(options)
    return { dryRun: true }
  }

  const workspace = await createWorkspace()
  const sourceDir = workspace.app

  try {
    const wrangler = new Wrangler({ sourceDir, options })
    await wrangler.ensure()

    log.step('Checking Cloudflare access')
    await wrangler.ensureAuth({ interactive: !options.yes })
    await wrangler.preflight({ projectName: options.projectName, dbName: options.dbName })

    log.step('Preparing the WhelkMail source')
    const source = await prepareSource(workspace, options)
    log.success(`Using WhelkMail ${source.version} (${source.kind}: ${source.origin})`)

    log.step('Installing dependencies')
    await installDependencies(sourceDir)
    await wrangler.ensure()

    log.step('Provisioning Cloudflare resources')
    const database = await wrangler.ensureD1(options.dbName)
    if (options.r2) {
      await wrangler.ensureR2Bucket(options.r2Bucket)
    }

    await wrangler.ensurePagesProject(options.projectName, options.branch)
    writePagesConfig(
      sourceDir,
      buildPagesConfig({
        projectName: options.projectName,
        dbName: database.name,
        dbId: database.id,
        r2Bucket: options.r2 ? options.r2Bucket : null,
      }),
    )

    log.step('Checking the installation state')
    const fresh = !(await wrangler.hasTable(database.name, 'accounts'))
    const meta = await readInstallerMeta(wrangler, database.name)

    log.step('Configuring secrets')
    const password = await resolvePassword(options)
    const tokenKey = await resolveTokenKey(options, {
      storedFingerprint: meta.token_enc_key_sha256 ?? null,
      fresh,
    })
    await wrangler.putPagesSecret(options.projectName, 'APP_PASSWORD', password.value)
    await wrangler.putPagesSecret(options.projectName, 'TOKEN_ENC_KEY', tokenKey.value)
    await writeInstallerMeta(wrangler, database.name, {
      token_enc_key_sha256: tokenKey.fingerprint,
      whelkmail_version: source.version,
      project_name: options.projectName,
    })

    let cronSecret = null
    if (options.cron) {
      if (options.isActions && !options.cronSecret) {
        throw new InstallerError(
          'CRON_SECRET is required in GitHub Actions when cron or Web Push is enabled',
          { hint: 'Add a CRON_SECRET repository secret and rerun the workflow.' },
        )
      }
      cronSecret = options.cronSecret || generateCronSecret()
      await wrangler.putPagesSecret(options.projectName, 'CRON_SECRET', cronSecret)
    }

    let vapid = null
    if (options.push) {
      vapid = await generateVapid(sourceDir)
      const subject =
        options.pushSubject ||
        process.env.VAPID_SUBJECT ||
        `https://${options.projectName}.pages.dev`
      await wrangler.putPagesSecret(options.projectName, 'VAPID_PUBLIC_KEY', vapid.publicKey)
      await wrangler.putPagesSecret(options.projectName, 'VAPID_PRIVATE_KEY', vapid.privateKey)
      await wrangler.putPagesSecret(options.projectName, 'VAPID_SUBJECT', subject)
    }

    log.step('Applying the database schema')
    if (fresh) {
      await wrangler.executeFile(database.name, 'db/schema.sql')
      log.success('Fresh database created from db/schema.sql')
    }
    await initialiseDatabase(wrangler, sourceDir, database.name, { fresh })

    log.step('Building the app')
    await runNpm(sourceDir, ['run', 'build'], 'Build failed')

    log.step('Deploying to Cloudflare Pages')
    const deployed = await wrangler.deployPages({
      project: options.projectName,
      branch: options.branch,
    })
    log.success(`Deployed at ${deployed.url}`)

    if (!options.noHealth) {
      log.step('Checking the deployment')
      await waitForHealth(deployed.url)
    }

    if (options.cron) {
      log.step('Deploying the cron worker')
      const workerConfig = ensureWorkerConfig(sourceDir, {
        projectName: options.projectName,
        appUrl: deployed.url,
      })
      await wrangler.deployWorker(workerConfig)
      await wrangler.putWorkerSecret(workerConfig, 'CRON_SECRET', cronSecret)
      log.success('Cron worker deployed')
    }

    return {
      url: deployed.url,
      projectName: options.projectName,
      dbName: database.name,
      version: source.version,
      r2Bucket: options.r2 ? options.r2Bucket : null,
      cron: options.cron,
      push: options.push,
      tokenKeyFingerprint: tokenKey.fingerprint,
      generatedPassword: password.generated ? password.value : null,
      generatedTokenKey: tokenKey.generated ? tokenKey.value : null,
      generatedCronSecret: cronSecret && !options.cronSecret ? cronSecret : null,
    }
  } finally {
    await workspace.cleanup(options.keep)
  }
}

function printPlan(options) {
  if (options.source) {
    const manifest = validateSource(options.source)
    log.info(`Source:   ${options.source} (WhelkMail ${manifest.version})`)
  } else {
    log.info(`Source:   GitHub release ${options.ref}`)
  }
  log.info(`Project:  ${options.projectName} (branch ${options.branch})`)
  log.info(`Database: ${options.dbName}`)
  log.info(`R2:       ${options.r2 ? `${options.r2Bucket} (billing required)` : 'disabled'}`)
  log.info(`Cron:     ${options.cron ? 'yes' : 'no'}`)
  log.info(`Push:     ${options.push ? 'yes' : 'no'}`)
  log.info(`Auth:     ${options.apiToken ? 'CLOUDFLARE_API_TOKEN' : 'wrangler login'}`)
  log.info('No changes will be made (--dry-run).')
}

async function installDependencies(dir) {
  log.info('Running npm ci, this can take a minute...')
  const hasLock = existsSync(join(dir, 'package-lock.json'))
  const args = hasLock
    ? ['ci', '--no-audit', '--no-fund']
    : ['install', '--no-audit', '--no-fund']
  const npm = npmCommand()
  const result = await run(npm.command, [...npm.prefix, ...args], {
    cwd: dir,
    capture: true,
    allowFail: true,
    shell: npm.shell,
  })
  if (result.code !== 0) {
    throw new InstallerError('Dependency installation failed', {
      hint: tail(result.stdout + result.stderr),
    })
  }
  log.success('Dependencies installed')
}

async function runNpm(dir, args, message) {
  const npm = npmCommand()
  const result = await run(npm.command, [...npm.prefix, ...args], {
    cwd: dir,
    capture: true,
    allowFail: true,
    shell: npm.shell,
  })
  if (result.code !== 0) {
    throw new InstallerError(message, { hint: tail(result.stdout + result.stderr) })
  }
}

async function resolvePassword(options) {
  if (options.appPassword) {
    return { value: options.appPassword, generated: false }
  }
  if (options.yes) {
    throw new InstallerError('APP_PASSWORD is required in non-interactive mode', {
      hint: 'Set APP_PASSWORD in the environment.',
    })
  }

  const typed = (await askSecret('Login password (leave empty to generate one)')).trim()
  if (typed) {
    return { value: typed, generated: false }
  }

  const generated = generatePassword()
  log.warn(`Generated APP_PASSWORD: ${generated}`)
  log.warn('Save it now: it is not written to disk or to this repository.')
  return { value: generated, generated: true }
}

async function resolveTokenKey(options, { storedFingerprint, fresh }) {
  const plan = planTokenKey({
    provided: options.tokenEncKey,
    storedFingerprint,
    fresh,
    rotate: options.rotateTokenKey,
  })

  if (plan.action === 'use') {
    const problem = validateTokenKey(options.tokenEncKey)
    if (problem) {
      throw new InstallerError(problem)
    }
    return {
      value: options.tokenEncKey.trim(),
      generated: false,
      fingerprint: plan.fingerprint,
    }
  }

  if (plan.action === 'generate' || plan.action === 'rotate') {
    const generated = generateTokenKey()
    if (plan.action === 'rotate') {
      log.warn('Rotating TOKEN_ENC_KEY because --rotate-token-key was passed.')
      log.warn('Stored mailbox credentials can no longer be decrypted and must be re-entered.')
    }
    log.warn(`Generated TOKEN_ENC_KEY: ${generated}`)
    log.warn('Store it somewhere safe. Changing it later invalidates stored credentials.')
    return {
      value: generated,
      generated: true,
      fingerprint: fingerprintSecret(generated),
    }
  }

  if (plan.action === 'mismatch') {
    throw new InstallerError('TOKEN_ENC_KEY does not match this deployment', {
      hint: [
        `Stored fingerprint:   ${plan.storedFingerprint.slice(0, 16)}...`,
        `Provided fingerprint: ${plan.fingerprint.slice(0, 16)}...`,
        '',
        'Pass the key used by the existing deployment, or pass --rotate-token-key',
        'to replace it. Rotating invalidates stored mailbox credentials.',
      ].join('\n'),
    })
  }

  if (!options.yes) {
    const label =
      plan.action === 'recover'
        ? 'Existing TOKEN_ENC_KEY for this deployment'
        : 'TOKEN_ENC_KEY (this deployment has no stored fingerprint)'
    const typed = (await askSecret(label)).trim()
    if (!typed) {
      throw new InstallerError('TOKEN_ENC_KEY is required to reuse this deployment', {
        hint: 'Pass the key in TOKEN_ENC_KEY, or pass --rotate-token-key to generate a new one and re-enter stored credentials.',
      })
    }
    const problem = validateTokenKey(typed)
    if (problem) {
      throw new InstallerError(problem)
    }
    const fingerprint = fingerprintSecret(typed)
    if (storedFingerprint && fingerprint !== storedFingerprint) {
      throw new InstallerError('TOKEN_ENC_KEY does not match this deployment', {
        hint: `Stored fingerprint: ${storedFingerprint.slice(0, 16)}..., provided: ${fingerprint.slice(0, 16)}...`,
      })
    }
    return { value: typed, generated: false, fingerprint }
  }

  const reason = options.isActions
    ? 'TOKEN_ENC_KEY is required in GitHub Actions to reuse an existing deployment'
    : 'TOKEN_ENC_KEY is required to reuse this deployment'
  throw new InstallerError(reason, {
    hint: 'Set TOKEN_ENC_KEY to the key used by the existing deployment, or pass --rotate-token-key.',
  })
}

async function generateVapid(dir) {
  const result = await run(process.execPath, [join(dir, 'scripts', 'generate-vapid.mjs')], {
    cwd: dir,
    capture: true,
    allowFail: true,
  })
  if (result.code !== 0) {
    throw new InstallerError('VAPID key generation failed', {
      hint: tail(result.stdout + result.stderr),
    })
  }

  const values = {}
  for (const line of result.stdout.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index > 0) {
      values[line.slice(0, index)] = line.slice(index + 1).trim()
    }
  }

  if (!values.VAPID_PUBLIC_KEY || !values.VAPID_PRIVATE_KEY) {
    throw new InstallerError('VAPID key generation produced unexpected output', {
      hint: tail(result.stdout),
    })
  }

  return {
    publicKey: values.VAPID_PUBLIC_KEY,
    privateKey: values.VAPID_PRIVATE_KEY,
  }
}

async function waitForHealth(url) {
  const endpoint = `${url}/api/health`
  let last = 'no response'

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        headers: { 'User-Agent': 'whelkmail-installer' },
        signal: AbortSignal.timeout(10000),
      })
      const body = await response.text()
      last = `HTTP ${response.status}: ${body.slice(0, 300)}`
      if (response.ok) {
        try {
          const parsed = JSON.parse(body)
          if (parsed?.ok === true) {
            log.success('Health check passed')
            return
          }
        } catch {
          last = `Unexpected health response: ${body.slice(0, 300)}`
        }
      }
    } catch (error) {
      last = error.message
    }

    if (attempt < 10) {
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }

  throw new InstallerError(`Health check failed at ${endpoint}`, {
    hint: `${last}\nOpen the Pages project, Deployments, Logs. Use --no-health to skip this check.`,
  })
}
