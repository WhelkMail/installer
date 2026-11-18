import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CommandError } from './errors.mjs'

const MAX_OUTPUT = 10 * 1024 * 1024
const SENSITIVE_ENV = [
  'APP_PASSWORD',
  'TOKEN_ENC_KEY',
  'CRON_SECRET',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'GITHUB_TOKEN',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
]

function childEnv(extra) {
  const env = { ...process.env }
  for (const name of SENSITIVE_ENV) {
    delete env[name]
  }
  return { ...env, ...extra }
}

export function nativeBin(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name
}

export function npmCommand() {
  const candidates = []
  if (process.env.npm_execpath && /npm-cli\.js$/i.test(process.env.npm_execpath)) {
    candidates.push(process.env.npm_execpath)
  }

  const execDir = dirname(process.execPath)
  candidates.push(join(execDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  candidates.push(join(execDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  candidates.push(join(execDir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'))

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { command: process.execPath, prefix: [candidate], shell: false }
    }
  }

  return { command: nativeBin('npm'), prefix: [], shell: true }
}

export function run(command, args, options = {}) {
  const {
    cwd,
    input,
    env,
    capture = false,
    allowFail = false,
    shell = false,
  } = options

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: childEnv(env),
      stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['inherit', 'inherit', 'inherit'],
      windowsHide: true,
      shell,
    })

    let stdout = ''
    let stderr = ''

    const append = (current, chunk) => {
      const next = current + chunk.toString()
      return next.length > MAX_OUTPUT ? next.slice(-MAX_OUTPUT) : next
    }

    if (capture && child.stdout && child.stderr) {
      child.stdout.on('data', (chunk) => {
        stdout = append(stdout, chunk)
      })
      child.stderr.on('data', (chunk) => {
        stderr = append(stderr, chunk)
      })
    }

    if (child.stdin) {
      child.stdin.end(input !== undefined ? input : undefined)
    }

    child.on('error', (error) => {
      reject(
        new CommandError({
          command,
          args,
          code: error.code ?? 'spawn',
          output: error.message,
        }),
      )
    })

    child.on('close', (code) => {
      const result = { code: code ?? 1, stdout, stderr }
      if (result.code === 0 || allowFail) {
        resolve(result)
        return
      }
      reject(
        new CommandError({
          command,
          args,
          code: result.code,
          output: [stdout, stderr].filter(Boolean).join('\n'),
        }),
      )
    })
  })
}
