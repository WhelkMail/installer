const colorEnabled =
  Boolean(process.stdout.isTTY) &&
  !process.env.NO_COLOR &&
  process.env.TERM !== 'dumb'

function paint(code) {
  return (text) => (colorEnabled ? `\u001b[${code}m${text}\u001b[0m` : text)
}

export const color = {
  bold: paint('1'),
  dim: paint('2'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  cyan: paint('36'),
}

let verbose = false

export function setVerbose(value) {
  verbose = Boolean(value)
}

export const log = {
  banner() {
    console.log('')
    console.log(color.bold('WhelkMail installer'))
    console.log(color.dim('Cloudflare Pages + Functions + D1'))
  },
  step(message) {
    console.log(`\n${color.cyan('>')} ${color.bold(message)}`)
  },
  info(message) {
    console.log(`  ${message}`)
  },
  detail(message) {
    if (verbose) {
      console.log(`  ${color.dim(message)}`)
    }
  },
  success(message) {
    console.log(`  ${color.green('[ok]')} ${message}`)
  },
  warn(message) {
    console.log(`  ${color.yellow('[!]')} ${message}`)
  },
  error(message) {
    console.error(`  ${color.red('[x]')} ${message}`)
  },
  raw(message) {
    console.log(message)
  },
}
