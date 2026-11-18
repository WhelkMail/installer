import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const roots = ['bin', 'src', 'action', 'test', 'scripts']
const files = []

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') {
        walk(full)
      }
      continue
    }
    if (/\.(mjs|js)$/.test(entry.name)) {
      files.push(full)
    }
  }
}

for (const root of roots) {
  try {
    walk(root)
  } catch {
    continue
  }
}

let failed = false
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })
  if (result.status !== 0) {
    failed = true
  }
}

if (failed) {
  process.exit(1)
}

console.log(`Checked ${files.length} file(s).`)
