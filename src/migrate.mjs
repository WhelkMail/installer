import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { InstallerError } from './errors.mjs'
import { log } from './log.mjs'

const REGISTRY =
  'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)'

export function planMigrations({ fresh, applied, files }) {
  const pending = files.filter((file) => !applied.has(file))
  if (pending.length === 0) {
    return { mode: 'none', pending }
  }
  if (fresh || applied.size === 0) {
    return { mode: 'record', pending }
  }
  return { mode: 'apply', pending }
}

export async function initialiseDatabase(wrangler, sourceDir, database, { fresh }) {
  await wrangler.executeStatement(database, REGISTRY)

  const applied = new Set(
    (await wrangler.query(database, 'SELECT name FROM schema_migrations')).map((row) =>
      String(row.name),
    ),
  )
  const files = readdirSync(join(sourceDir, 'db', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const plan = planMigrations({ fresh, applied, files })
  const pending = plan.pending

  if (plan.mode === 'none') {
    log.detail('No pending migrations')
    return
  }

  if (plan.mode === 'record') {
    const missing = await missingRequirements(wrangler, sourceDir, database, files)
    if (missing.length > 0) {
      throw new InstallerError('The database schema is missing objects from some migrations', {
        hint: [
          ...missing.map((entry) => `${entry.file}: ${entry.requirement}`),
          '',
          'A newer WhelkMail release is probably needed, or the database was',
          'created from an older schema. Apply the migrations manually with the',
          'WhelkMail repository scripts, then rerun the installer.',
        ].join('\n'),
      })
    }
    for (const file of pending) {
      await record(wrangler, database, file)
    }
    log.success(`Recorded ${pending.length} migration(s) already present in the schema`)
    return
  }

  for (const file of pending) {
    log.info(`Applying db/migrations/${file}`)
    await wrangler.executeFile(database, `db/migrations/${file}`)
    await record(wrangler, database, file)
  }
  log.success(`Applied ${pending.length} migration(s)`)
}

export function netRequirements(entries) {
  const tables = new Map()
  const columns = new Map()
  const indexes = new Map()

  for (const { file, sql, requirements } of entries) {
    const stripped = String(sql)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ')

    const indexTables = new Map()
    for (const match of stripped.matchAll(
      /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)/gi,
    )) {
      indexTables.set(match[1], match[2])
    }

    for (const match of stripped.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)/gi)) {
      const name = match[1]
      tables.delete(name)
      for (const [key, entry] of columns) {
        if (entry.item.table === name) {
          columns.delete(key)
        }
      }
      for (const [key, entry] of indexes) {
        if (entry.table === name) {
          indexes.delete(key)
        }
      }
    }
    for (const match of stripped.matchAll(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(\w+)/gi)) {
      indexes.delete(match[1])
    }

    for (const item of requirements) {
      if (item.kind === 'table') {
        tables.set(item.name, { item, file })
      } else if (item.kind === 'column') {
        columns.set(`${item.table}.${item.name}`, { item, file })
      } else {
        indexes.set(item.name, { item, file, table: indexTables.get(item.name) ?? null })
      }
    }
  }

  return [...tables.values(), ...columns.values(), ...indexes.values()]
}

async function missingRequirements(wrangler, sourceDir, database, files) {
  const module = await import(
    pathToFileURL(join(sourceDir, 'scripts', 'migration-requirements.mjs')).href
  )
  const entries = files.map((file) => {
    const sql = readFileSync(join(sourceDir, 'db', 'migrations', file), 'utf8')
    return { file, sql, requirements: module.requirementsFromSql(sql) }
  })
  const missing = []

  for (const { item, file } of netRequirements(entries)) {
    if (!(await requirementPresent(wrangler, database, item))) {
      missing.push({ file, requirement: module.describeRequirement(item) })
    }
  }

  return missing
}

async function requirementPresent(wrangler, database, item) {
  if (item.kind === 'table') {
    const rows = await wrangler.query(
      database,
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${item.name}'`,
    )
    return rows.length > 0
  }

  if (item.kind === 'column') {
    const rows = await wrangler.query(
      database,
      `SELECT name FROM pragma_table_info('${item.table}') WHERE name = '${item.name}'`,
    )
    return rows.length > 0
  }

  const rows = await wrangler.query(
    database,
    `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = '${item.name}'`,
  )
  if (rows.length === 0) {
    return false
  }
  if (!item.unique) {
    return true
  }
  return /^\s*CREATE\s+UNIQUE\s+INDEX/i.test(String(rows[0]?.sql ?? ''))
}

async function record(wrangler, database, file) {
  await wrangler.executeStatement(
    database,
    `INSERT OR REPLACE INTO schema_migrations (name, applied_at) VALUES ('${file}', datetime('now'))`,
  )
}
