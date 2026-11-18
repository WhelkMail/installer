import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { download, fetchJson, fetchText } from './http.mjs'
import { InstallerError, tail } from './errors.mjs'
import { run } from './exec.mjs'
import { log } from './log.mjs'

const REPOSITORY = 'WhelkMail/WhelkMail'
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.wrangler',
  '.kilo',
  'coverage',
  'whelkmail-demo',
])
const EXCLUDED_FILES = new Set(['wrangler.toml', join('worker', 'wrangler.toml')])
const SECRET_FILE = /(^|[\\/])(\.env|\.dev\.vars)(\..*)?$/

export async function createWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'whelkmail-installer-'))
  const app = join(dir, 'app')
  await mkdir(app, { recursive: true })
  return {
    dir,
    app,
    async cleanup(keep) {
      if (keep) {
        log.info(`Workspace kept at ${dir}`)
        return
      }
      try {
        await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      } catch (error) {
        log.warn(`Could not remove the temporary workspace ${dir}: ${error.message}`)
      }
    },
  }
}

export function validateSource(dir) {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) {
    throw new InstallerError(`Not a WhelkMail source directory: ${dir}`)
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new InstallerError(`Invalid package.json in ${dir}: ${error.message}`)
  }
  if (manifest.name !== 'whelkmail') {
    throw new InstallerError(`${dir} is not the WhelkMail repository (package name: ${manifest.name})`)
  }
  for (const file of [
    'db/schema.sql',
    'db/migrations',
    'scripts/migrate.mjs',
    'scripts/migration-requirements.mjs',
  ]) {
    if (!existsSync(join(dir, file))) {
      throw new InstallerError(`Missing ${file} in the WhelkMail source`)
    }
  }
  if (!existsSync(join(dir, 'functions'))) {
    throw new InstallerError('Missing functions/ in the WhelkMail source')
  }
  return { version: String(manifest.version ?? 'unknown') }
}

export async function prepareSource(workspace, options) {
  if (options.source) {
    const root = resolve(options.source)
    if (!existsSync(root)) {
      throw new InstallerError(`--source does not exist: ${root}`)
    }
    await cp(root, workspace.app, {
      recursive: true,
      force: true,
      filter: (entry) => shouldCopy(root, entry),
    })
    const manifest = validateSource(workspace.app)
    return { kind: 'local', origin: root, version: manifest.version }
  }

  const resolved = await resolveRef(options.ref, options.githubToken)
  const archive = join(workspace.dir, 'source.tar.gz')
  let lastError = null
  for (const url of resolved.urls) {
    try {
      await download(url, archive, { token: options.githubToken })
      lastError = null
      break
    } catch (error) {
      lastError = error
      if (!/HTTP 404/.test(error.message)) {
        throw error
      }
    }
  }
  if (lastError) {
    throw lastError
  }

  log.info(`Extracting ${resolved.ref}...`)
  const extracted = await run('tar', ['-xzf', archive, '-C', workspace.app, '--strip-components=1'], {
    capture: true,
    allowFail: true,
  })
  if (extracted.code !== 0) {
    throw new InstallerError('Could not extract the source archive', {
      hint: `${tail(extracted.stdout + extracted.stderr)}\nA working "tar" command is required.`,
    })
  }

  const manifest = validateSource(workspace.app)
  return { kind: 'release', origin: resolved.ref, version: manifest.version }
}

export async function resolveRef(ref, token) {
  if (ref === 'latest') {
    const tag = await latestTag(token)
    return { ref: tag, urls: [codeloadUrl('tags', tag)] }
  }
  const kinds = /^v?\d/.test(ref) ? ['tags', 'heads'] : ['heads', 'tags']
  const urls = kinds.map((kind) => codeloadUrl(kind, ref))
  if (/^v\d/.test(ref)) {
    urls.push(codeloadUrl('tags', ref.slice(1)))
  } else if (/^\d/.test(ref)) {
    urls.push(codeloadUrl('tags', `v${ref}`))
  }
  return { ref, urls }
}

function codeloadUrl(kind, ref) {
  const encoded = ref.split('/').map(encodeURIComponent).join('/')
  return `https://codeload.github.com/${REPOSITORY}/tar.gz/refs/${kind}/${encoded}`
}

async function latestTag(token) {
  try {
    const release = await fetchJson(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, { token })
    if (release?.tag_name) {
      return String(release.tag_name)
    }
  } catch {
    log.detail('GitHub API unavailable for the latest release, trying the releases page')
  }

  try {
    const page = await fetchText(`https://github.com/${REPOSITORY}/releases/latest`, {
      redirect: 'manual',
    })
    const fromHeader = /\/(?:tag|releases\/tag)\/([^/?#]+)/.exec(page.location ?? '')
    if (fromHeader) {
      return decodeURIComponent(fromHeader[1])
    }
    const fromBody = new RegExp(`/${REPOSITORY.replace('/', '\\/')}/releases/tag/([^"?#]+)`).exec(page.text)
    if (fromBody) {
      return decodeURIComponent(fromBody[1])
    }
  } catch {
    log.detail('Releases page unavailable')
  }

  throw new InstallerError('Could not resolve the latest WhelkMail release', {
    hint: 'Pass --ref <tag> (for example --ref 1.0.1) or set GITHUB_TOKEN to raise the API rate limit.',
  })
}

function shouldCopy(root, entry) {
  const rel = relative(root, entry)
  if (!rel) {
    return true
  }
  if (SECRET_FILE.test(rel) || EXCLUDED_FILES.has(rel)) {
    return false
  }
  const top = rel.split(sep)[0]
  return !EXCLUDED_DIRS.has(top)
}
