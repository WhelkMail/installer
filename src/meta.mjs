import { createHash } from 'node:crypto'

const TABLE = 'installer_meta'

export function fingerprintSecret(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function planTokenKey({ provided, storedFingerprint, fresh, rotate }) {
  const text = provided === undefined || provided === null ? '' : String(provided).trim()
  if (text) {
    const fingerprint = fingerprintSecret(text)
    if (storedFingerprint && storedFingerprint !== fingerprint && !rotate) {
      return { action: 'mismatch', fingerprint, storedFingerprint }
    }
    return { action: 'use', fingerprint }
  }
  if (fresh) {
    return { action: 'generate' }
  }
  if (rotate) {
    return { action: 'rotate' }
  }
  if (storedFingerprint) {
    return { action: 'recover' }
  }
  return { action: 'unknown' }
}

export async function readInstallerMeta(wrangler, database) {
  await wrangler.executeStatement(
    database,
    `CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  )
  const rows = await wrangler.query(database, `SELECT key, value FROM ${TABLE}`)
  const meta = {}
  for (const row of rows) {
    meta[String(row.key)] = String(row.value)
  }
  return meta
}

export async function writeInstallerMeta(wrangler, database, values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) {
      continue
    }
    await wrangler.executeStatement(
      database,
      `INSERT OR REPLACE INTO ${TABLE} (key, value, updated_at) VALUES (${sql(key)}, ${sql(value)}, datetime('now'))`,
    )
  }
}

function sql(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}
