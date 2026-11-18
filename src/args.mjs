const VALUE_FLAGS = new Map([
  ['--source', 'source'],
  ['--ref', 'ref'],
  ['--project-name', 'projectName'],
  ['--db-name', 'dbName'],
  ['--branch', 'branch'],
  ['--r2-bucket', 'r2Bucket'],
  ['--push-subject', 'pushSubject'],
  ['--account-id', 'accountId'],
])

const BOOLEAN_FLAGS = new Map([
  ['--r2', 'r2'],
  ['--cron', 'cron'],
  ['--push', 'push'],
  ['--yes', 'yes'],
  ['--rotate-token-key', 'rotateTokenKey'],
  ['--dry-run', 'dryRun'],
  ['--no-health', 'noHealth'],
  ['--keep', 'keep'],
  ['--verbose', 'verbose'],
  ['--help', 'help'],
])

const PROJECT_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/

export function defaultOptions() {
  return {
    source: null,
    ref: 'latest',
    projectName: 'whelkmail',
    dbName: 'mail-client',
    branch: 'main',
    r2: false,
    r2Bucket: null,
    cron: false,
    push: false,
    pushSubject: null,
    accountId: undefined,
    yes: false,
    rotateTokenKey: false,
    dryRun: false,
    noHealth: false,
    keep: false,
    verbose: false,
    help: false,
    appPassword: undefined,
    tokenEncKey: undefined,
    cronSecret: undefined,
    apiToken: undefined,
    githubToken: undefined,
    isActions: false,
  }
}

export function parseArgs(argv) {
  const options = defaultOptions()
  const errors = []
  const args = [...argv]

  while (args.length > 0) {
    const token = args.shift()
    if (token === '--') {
      errors.push('Positional arguments are not supported')
      break
    }

    const equals = token.indexOf('=')
    const name = equals > 0 ? token.slice(0, equals) : token
    const inlineValue = equals > 0 ? token.slice(equals + 1) : undefined

    if (BOOLEAN_FLAGS.has(name)) {
      if (inlineValue !== undefined) {
        errors.push(`${name} does not take a value`)
        continue
      }
      options[BOOLEAN_FLAGS.get(name)] = true
      continue
    }

    if (VALUE_FLAGS.has(name)) {
      let value = inlineValue
      if (value === undefined) {
        value = args.shift()
      }
      if (value === undefined || value === '') {
        errors.push(`${name} requires a value`)
        continue
      }
      options[VALUE_FLAGS.get(name)] = value
      continue
    }

    errors.push(`Unknown option: ${token}`)
  }

  if (options.r2Bucket && !options.r2) {
    options.r2 = true
  }
  if (options.push) {
    options.cron = true
  }
  if (options.r2 && !options.r2Bucket) {
    options.r2Bucket = `${options.projectName}-archive`
  }

  if (!PROJECT_NAME.test(options.projectName)) {
    errors.push('--project-name must be lowercase letters, digits and dashes (max 63 characters)')
  }
  if (!PROJECT_NAME.test(options.dbName)) {
    errors.push('--db-name must be lowercase letters, digits and dashes (max 63 characters)')
  }
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(options.branch)) {
    errors.push('--branch contains unsupported characters')
  }
  if (options.r2 && !BUCKET_NAME.test(options.r2Bucket)) {
    errors.push('--r2-bucket must be 3-63 lowercase characters, digits and dashes')
  }
  if (options.ref !== 'latest' && !REF.test(options.ref)) {
    errors.push('--ref contains unsupported characters')
  }
  if (
    options.pushSubject &&
    !/^(mailto:|https?:\/\/)/i.test(options.pushSubject)
  ) {
    errors.push('--push-subject must start with mailto:, http:// or https://')
  }

  return { options, errors }
}

export function helpText() {
  return [
    'Usage: whelkmail-installer [options]',
    '',
    'Options:',
    '  --source <dir>         Use a local WhelkMail checkout instead of downloading a release',
    '  --ref <tag|branch>     Source ref (default: latest GitHub release, e.g. 1.0.1)',
    '  --project-name <name>  Pages project name (default: whelkmail)',
    '  --db-name <name>       D1 database name (default: mail-client)',
    '  --branch <name>        Production branch for Pages (default: main)',
    '  --r2                   Create an R2 bucket and bind it as BUCKET',
    '  --r2-bucket <name>     R2 bucket name (implies --r2)',
    '  --cron                 Deploy the 5-minute cron worker',
    '  --push                 Generate VAPID keys and deploy the cron worker',
    '  --push-subject <value> VAPID subject, mailto:... or https://...',
    '  --account-id <id>      Cloudflare account id (or CLOUDFLARE_ACCOUNT_ID)',
    '  --yes                  Non-interactive; secrets must come from the environment',
    '  --rotate-token-key     Replace TOKEN_ENC_KEY (invalidates stored mailbox credentials)',
    '  --dry-run              Validate the options and print the plan without changes',
    '  --no-health            Skip the post-deploy /api/health check',
    '  --keep                 Keep the temporary workspace for inspection',
    '  --verbose              Print every command and its full output',
    '  --help                 Show this help',
    '',
    'Environment:',
    '  APP_PASSWORD           Login password for the deployment',
    '  TOKEN_ENC_KEY          32 random bytes encoded in base64',
    '  CLOUDFLARE_API_TOKEN   API token used instead of the interactive login',
    '  CLOUDFLARE_ACCOUNT_ID  Account id for token based runs',
    '  GITHUB_TOKEN           Optional, raises the GitHub API rate limit',
    '  CRON_SECRET            Optional, reuse an existing cron secret',
    '',
    'Cross-platform: Windows, macOS and Linux with Node.js 22 or newer.',
  ].join('\n')
}
