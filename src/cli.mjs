import { envOptions } from './env.mjs'
import { InstallerError, tail } from './errors.mjs'
import { parseArgs, helpText } from './args.mjs'
import { log, setVerbose } from './log.mjs'
import { runInstaller } from './run.mjs'

export async function main(argv) {
  const parsed = parseArgs(argv)

  if (parsed.options.help) {
    console.log(helpText())
    return 0
  }

  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      log.error(error)
    }
    console.error('')
    console.error(helpText())
    return 1
  }

  const env = envOptions()
  const options = { ...env }
  for (const [key, value] of Object.entries(parsed.options)) {
    if (value !== undefined && value !== null) {
      options[key] = value
    }
  }
  options.isActions = env.isActions

  setVerbose(options.verbose)
  log.banner()

  try {
    await runInstaller(options)
    return 0
  } catch (error) {
    report(error, options)
    return 1
  }
}

function report(error, options) {
  if (error instanceof InstallerError) {
    log.error(error.message)
    const detail = error.hint || error.output
    if (detail) {
      console.error('')
      console.error(tail(detail).replace(/^/gm, '  '))
    }
    if (options.verbose && error.stack) {
      console.error(error.stack)
    }
    return
  }

  log.error(error?.message ?? String(error))
  if (options.verbose && error?.stack) {
    console.error(error.stack)
  }
}
