export class InstallerError extends Error {
  constructor(message, { hint, cause } = {}) {
    super(message, { cause })
    this.name = 'InstallerError'
    this.hint = hint
  }
}

export class CommandError extends InstallerError {
  constructor({ command, args, code, output, hint }) {
    super(`Command failed with exit code ${code}: ${formatCommand(command, args)}`, { hint })
    this.name = 'CommandError'
    this.command = command
    this.args = args
    this.code = code
    this.output = output ?? ''
  }
}

export function formatCommand(command, args = []) {
  return [command, ...args]
    .map((part) => (/[\s"]/.test(part) ? JSON.stringify(part) : part))
    .join(' ')
}

export function tail(text, limit = 4000) {
  const value = String(text ?? '').trim()
  return value.length > limit ? `...${value.slice(-limit)}` : value
}
