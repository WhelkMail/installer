import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { InstallerError } from './errors.mjs'

async function question(text) {
  const readline = createInterface({ input: stdin, output: stdout })
  try {
    return await readline.question(text)
  } finally {
    readline.close()
  }
}

export async function ask(text, { defaultValue = '' } = {}) {
  const suffix = defaultValue ? ` [${defaultValue}]` : ''
  const answer = (await question(`${text}${suffix}: `)).trim()
  return answer || defaultValue
}

export async function askSecret(text) {
  if (!stdin.isTTY) {
    const answer = await question(`${text}: `)
    return answer.replace(/\r$/, '')
  }

  stdout.write(`${text}: `)
  return new Promise((resolve, reject) => {
    stdin.resume()
    stdin.setRawMode(true)
    stdin.setEncoding('utf8')

    let value = ''

    const cleanup = () => {
      stdin.removeListener('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
    }

    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanup()
          stdout.write('\n')
          resolve(value)
          return
        }
        if (char === '\u0003') {
          cleanup()
          stdout.write('\n')
          reject(new InstallerError('Interrupted'))
          return
        }
        if (char === '\u007f' || char === '\b') {
          if (value) {
            value = value.slice(0, -1)
            stdout.write('\b \b')
          }
          continue
        }
        if (char < ' ') {
          continue
        }
        value += char
        stdout.write('*')
      }
    }

    stdin.on('data', onData)
  })
}
