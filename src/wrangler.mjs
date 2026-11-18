import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { InstallerError, tail } from './errors.mjs'
import { npmCommand, run } from './exec.mjs'
import { extractJson } from './json.mjs'
import { log } from './log.mjs'

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

    if (!this.options.accountId) {
      const ids = [...new Set((whoami.stdout.match(/[0-9a-f]{32}/g) ?? []))]
      if (ids.length === 1) {
        this.options.accountId = ids[0]
      } else if (ids.length > 1) {
        log.warn('Multiple Cloudflare accounts found; using the first one. Pass --account-id to choose.')
        this.options.accountId = ids[0]
      }
    }

    log.success('Cloudflare credentials verified')
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
