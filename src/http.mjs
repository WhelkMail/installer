import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { InstallerError } from './errors.mjs'

const USER_AGENT = 'whelkmail-installer'

function headers(token) {
  const result = { 'User-Agent': USER_AGENT }
  if (token) {
    result.Authorization = `Bearer ${token}`
  }
  return result
}

export async function download(url, destination, { token, timeout = 120000 } = {}) {
  const response = await fetch(url, {
    headers: headers(token),
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  })
  if (!response.ok || !response.body) {
    throw new InstallerError(`Download failed with HTTP ${response.status}: ${url}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
  return destination
}

export async function fetchJson(url, { token, timeout = 15000 } = {}) {
  const response = await fetch(url, {
    headers: { ...headers(token), Accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  })
  if (!response.ok) {
    throw new InstallerError(`Request failed with HTTP ${response.status}: ${url}`)
  }
  return response.json()
}

export async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    headers: headers(options.token),
    redirect: options.redirect ?? 'follow',
    signal: AbortSignal.timeout(options.timeout ?? 15000),
  })
  return {
    status: response.status,
    location: response.headers.get('location'),
    text: await response.text(),
  }
}
