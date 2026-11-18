import { randomBytes, randomInt } from 'node:crypto'

const PASSWORD_ALPHABET =
  'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%*-_=+'

export function generateTokenKey() {
  return randomBytes(32).toString('base64')
}

export function validateTokenKey(value) {
  const text = String(value ?? '').trim()
  if (!text) {
    return 'TOKEN_ENC_KEY is empty'
  }
  const decoded = Buffer.from(text, 'base64')
  if (decoded.length !== 32) {
    return 'TOKEN_ENC_KEY must be 32 random bytes encoded in base64'
  }
  if (decoded.toString('base64').replace(/=+$/, '') !== text.replace(/=+$/, '')) {
    return 'TOKEN_ENC_KEY is not valid base64'
  }
  return null
}

export function generateCronSecret() {
  return randomBytes(24).toString('hex')
}

export function generatePassword(length = 24) {
  let value = ''
  for (let index = 0; index < length; index += 1) {
    value += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]
  }
  return value
}


