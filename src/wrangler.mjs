import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseAccounts, pickAccount } from './accounts.mjs'
import { InstallerError, tail } from './errors.mjs'
import { npmCommand, run } from './exec.mjs'
import { extractJson } from './json.mjs'
import { log } from './log.mjs'
import { ask } from './prompt.mjs'

const DATABASE_ID = /(?:database_id\s*=\s*|"uuid"\s*:\s*)"([0-9a-fA-F-]{36})"/

export class Wrangler {
  constructor({ sourceDir, options }) {
    this.sourceDir = sourceDir
    this.options = options
    this.command = null
    this.prefix = []
    this.shell = false
  }

  async ensure() {
    const local = join(this.sourceDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
    if (existsSync(local)) {
      this.command = process.execPath
      this.prefix = [local]
      return
    }
    const npm = npmCommand()
    this.command = npm.command
    this.prefix = [...npm.prefix, 'exec', '--yes', '--package=wrangler@4', '--', 'wrangler']
    this.shell = npm.shell
  }

  env() {
    const env = { WRANGLER_SEND_METRICS: 'false' }
    if (this.options.apiToken) {
      env.CLOUDFLARE_API_TOKEN = this.options.apiToken
    }
    if (this.options.accountId) {
      env.CLOUDFLARE_ACCOUNT_ID = this.options.accountId
    }
    if (process.env.CI) {
      env.CI = process.env.CI
    }
    return env
  }

  async run(args, options = {}) {
    log.detail(`wrangler ${args.join(' ')}`)
    return run(this.command, [...this.prefix, ...args], {
      cwd: this.sourceDir,
      env: this.env(),
      shell: this.shell,
      ...options,
    })
  }

  async ensureAuth({ interactive }) {
    if (!this.options.apiToken) {
      if (!interactive) {
        throw new InstallerError('No Cloudflare credentials available', {
          hint: 'Set CLOUDFLARE_API_TOKEN, or run without --yes to log in through the browser.',
        })
      }
      log.info('Opening the Cloudflare login flow...')
      await this.run(['login'], { capture: false })
    }

    const whoami = await this.run(['whoami'], { capture: true, allowFail: true })
    if (whoami.code !== 0) {
      throw new InstallerError('Cloudflare authentication failed', {
        hint: tail(whoami.stdout + whoami.stderr),
      })
    }

    await this.resolveAccount(parseAccounts(whoami.stdout), { interactive })
    log.success('Cloudflare credentials verified')
  }

  async resolveAccount(accounts, { interactive }) {
    let list = accounts
    if (list.length === 0 && this.options.apiToken) {
      list = await fetchTokenAccounts(this.options.apiToken)
    }

    if (this.options.accountId) {
      this.options.accountId = String(this.options.accountId).trim().toLowerCase()
      const match = list.find((account) => account.id === this.options.accountId)
      if (match?.name && match.name !== match.id) {
        log.info(`Account: ${match.name} (${match.id})`)
      } else {
        log.detail(`Using account ${this.options.accountId} from --account-id or the environment`)
      }
      return
    }

    if (list.length === 0) {
      throw new InstallerError('Could not determine the Cloudflare account', {
        hint: 'Pass --account-id <id> or set CLOUDFLARE_ACCOUNT_ID.',
      })
    }

    if (list.length === 1) {
      this.options.accountId = list[0].id
      log.info(`Account: ${list[0].name} (${list[0].id})`)
      return
    }

    if (!interactive) {
      throw new InstallerError('Multiple Cloudflare accounts are available', {
        hint: [
          'This token can access more than one account. Choose one explicitly:',
          '',
          ...list.map((account, index) => `  ${index + 1}. ${account.name} (${account.id})`),
          '',
          'Pass --account-id <id> or set CLOUDFLARE_ACCOUNT_ID.',
        ].join('\n'),
      })
    }

    log.info('Multiple Cloudflare accounts are available:')
    list.forEach((account, index) => {
      log.info(`  ${index + 1}. ${account.name} (${account.id})`)
    })
    const answer = await ask(`Choose an account number (1-${list.length})`)
    const chosen = pickAccount({ accounts: list, answer })
    if (!chosen) {
      throw new InstallerError(`Invalid account selection: ${answer || '(empty)'}`)
    }
    this.options.accountId = chosen.id
    log.info(`Using ${chosen.name} (${chosen.id})`)
  }

  async preflight({ projectName, dbName }) {
    if (this.options.apiToken) {
      await verifyApiToken(this.options)
    }

    const listed = await this.run(['d1', 'list', '--json'], { capture: true, allowFail: true })
    if (listed.code !== 0) {
      throw new InstallerError('Cannot list D1 databases with these credentials', {
        hint: `${tail(listed.stdout + listed.stderr)}\nCheck that the credentials can use Account -> D1 -> Edit on the selected account.`,
      })
    }

    let databases = []
    try {
      const rows = extractJson(listed.stdout)
      databases = Array.isArray(rows) ? rows : []
    } catch {
      log.detail('Could not parse "wrangler d1 list --json" during preflight')
    }
    const database =
      databases.find((row) => (row.name ?? row.database_name) === dbName) ?? null

    const pages = await this.run(['pages', 'project', 'list'], { capture: true, allowFail: true })
    if (pages.code !== 0) {
      throw new InstallerError('Cannot list Pages projects with these credentials', {
        hint: `${tail(pages.stdout + pages.stderr)}\nCheck that the credentials can use Account -> Cloudflare Pages -> Edit on the selected account.`,
      })
    }
    const project = new RegExp(
      `(^|[^a-z0-9-])${escapeRegex(projectName)}([^a-z0-9-]|$)`,
      'i',
    ).test(pages.stdout)

    if (database) {
      log.warn(`D1 database "${dbName}" already exists and will be reused`)
    }
    if (project) {
      log.warn(`Pages project "${projectName}" already exists and will be reused`)
    }
    log.success('Cloudflare permissions verified')
    return { database, project }
  }

  async ensureD1(name) {
    const created = await this.run(['d1', 'create', name], { capture: true, allowFail: true })
    const output = `${created.stdout}\n${created.stderr}`
    const alreadyExists = /already exists/i.test(output)
    let id = DATABASE_ID.exec(output)?.[1] ?? null

    if (!id) {
      const listed = await this.run(['d1', 'list', '--json'], { capture: true, allowFail: true })
      if (listed.code === 0) {
        try {
          const rows = extractJson(listed.stdout)
          const found = rows.find((row) => row.name === name || row.database_name === name)
          id = found?.uuid ?? found?.id ?? null
        } catch {
          log.detail('Could not parse "wrangler d1 list --json"')
        }
      }
    }

    if (!id) {
      throw new InstallerError(`Could not create or find the D1 database "${name}"`, {
        hint: tail(output),
      })
    }

    if (alreadyExists) {
      log.detail(`Reusing D1 database ${name} (${id})`)
    } else {
      log.success(`D1 database ${name} created`)
    }

    return { name, id }
  }

  async ensurePagesProject(name, branch) {
    const created = await this.run(
      ['pages', 'project', 'create', name, `--production-branch=${branch}`],
      { capture: true, allowFail: true },
    )
    const output = `${created.stdout}\n${created.stderr}`

    if (created.code === 0) {
      log.success(`Pages project ${name} created`)
      return false
    }
    if (/already exists/i.test(output)) {
      log.detail(`Reusing Pages project ${name}`)
      return true
    }

    throw new InstallerError(`Could not create the Pages project "${name}"`, {
      hint: tail(output),
    })
  }

  async ensureR2Bucket(name) {
    const created = await this.run(['r2', 'bucket', 'create', name], {
      capture: true,
      allowFail: true,
    })
    const output = `${created.stdout}\n${created.stderr}`

    if (created.code === 0) {
      log.success(`R2 bucket ${name} created`)
      return
    }
    if (/already exists/i.test(output)) {
      log.detail(`Reusing R2 bucket ${name}`)
      return
    }

    throw new InstallerError(`Could not create the R2 bucket "${name}"`, {
      hint: `${tail(output)}\nR2 requires billing to be enabled on the Cloudflare account. Drop --r2 to install without it.`,
    })
  }

  async putPagesSecret(project, name, value) {
    const result = await this.run(
      ['pages', 'secret', 'put', name, '--project-name', project],
      { capture: true, allowFail: true, input: value },
    )
    if (result.code !== 0) {
      throw new InstallerError(`Could not set the Pages secret ${name}`, {
        hint: tail(result.stdout + result.stderr),
      })
    }
    log.detail(`Pages secret ${name} set`)
  }

  async putWorkerSecret(configPath, name, value) {
    const result = await this.run(['secret', 'put', name, '-c', configPath], {
      capture: true,
      allowFail: true,
      input: value,
    })
    if (result.code !== 0) {
      throw new InstallerError(`Could not set the worker secret ${name}`, {
        hint: tail(result.stdout + result.stderr),
      })
    }
    log.detail(`Worker secret ${name} set`)
  }

  async query(database, statement) {
    const result = await this.run(
      ['d1', 'execute', database, '--remote', '--json', `--command=${statement}`],
      { capture: true, allowFail: true },
    )
    if (result.code !== 0) {
      throw new InstallerError(`Could not query the D1 database "${database}"`, {
        hint: tail(result.stdout + result.stderr),
      })
    }
    const parsed = extractJson(result.stdout)
    const first = Array.isArray(parsed) ? parsed[0] : parsed
    return first?.results ?? []
  }

  async hasTable(database, table) {
    const rows = await this.query(
      database,
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`,
    )
    return rows.length > 0
  }

  async executeStatement(database, statement) {
    const result = await this.run(
      ['d1', 'execute', database, '--remote', `--command=${statement}`, '--yes'],
      { capture: true, allowFail: true },
    )
    if (result.code !== 0) {
      throw new InstallerError('Failed to run a D1 statement', {
        hint: tail(result.stdout + result.stderr),
      })
    }
  }

  async executeFile(database, relativeFile) {
    log.detail(`Applying ${relativeFile}`)
    const result = await this.run(
      ['d1', 'execute', database, '--remote', `--file=${relativeFile}`, '--yes'],
      { capture: true, allowFail: true },
    )
    if (result.code !== 0) {
      throw new InstallerError(`Failed to apply ${relativeFile}`, {
        hint: tail(result.stdout + result.stderr),
      })
    }
  }

  async deployPages({ project, branch }) {
    const result = await this.run(
      ['pages', 'deploy', 'dist', `--project-name=${project}`, `--branch=${branch}`, '--commit-dirty=true'],
      { capture: true, allowFail: true },
    )
    if (result.code !== 0) {
      throw new InstallerError('Pages deployment failed', {
        hint: tail(result.stdout + result.stderr),
      })
    }
    log.detail(tail(result.stdout, 2000))
    return { url: `https://${project}.pages.dev` }
  }

  async deployWorker(configPath) {
    const result = await this.run(['deploy', '-c', configPath], {
      capture: true,
      allowFail: true,
    })
    if (result.code !== 0) {
      throw new InstallerError('Cron worker deployment failed', {
        hint: tail(result.stdout + result.stderr),
      })
    }
    log.detail(tail(result.stdout, 1500))
  }
}

async function fetchTokenAccounts(token) {
  try {
    const response = await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=50', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'whelkmail-installer',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      log.detail(`Could not list accounts from the Cloudflare API (HTTP ${response.status})`)
      return []
    }
    const body = await response.json()
    return (body.result ?? [])
      .filter((account) => account?.id)
      .map((account) => ({
        id: String(account.id).toLowerCase(),
        name: String(account.name ?? account.id),
      }))
  } catch (error) {
    log.detail(`Could not list accounts from the Cloudflare API: ${error.message}`)
    return []
  }
}

async function verifyApiToken(options) {
  const headers = {
    Authorization: `Bearer ${options.apiToken}`,
    'User-Agent': 'whelkmail-installer',
  }

  const verified = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
    headers,
    signal: AbortSignal.timeout(15000),
  })
  if (!verified.ok) {
    throw new InstallerError('The Cloudflare API token is not valid', {
      hint: `HTTP ${verified.status} from /user/tokens/verify`,
    })
  }

  if (!options.accountId) {
    return
  }

  const id = encodeURIComponent(options.accountId)
  const account = await fetch(`https://api.cloudflare.com/client/v4/accounts/${id}`, {
    headers,
    signal: AbortSignal.timeout(15000),
  })
  if (!account.ok) {
    log.warn(
      `Could not read account ${options.accountId} (HTTP ${account.status}); trying the D1 and Pages checks instead`,
    )
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
