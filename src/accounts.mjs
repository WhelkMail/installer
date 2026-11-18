const ANSI = /\u001b\[[0-9;]*m/g
const ACCOUNT_ID = /\b([0-9a-f]{32})\b/i
const LABEL_NAME = /Account Name\s*:\s*(.+)$/i
const LABEL_ID = /Account ID\s*:\s*([0-9a-f]{32})/i

export function parseAccounts(output) {
  const lines = String(output ?? '').replace(ANSI, '').split(/\r?\n/)
  const accounts = new Map()

  const add = (id, name) => {
    const key = id.toLowerCase()
    const clean = String(name ?? '')
      .replace(/[│┃|]/g, ' ')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!accounts.has(key) || (clean && accounts.get(key) === key)) {
      accounts.set(key, clean || key)
    }
  }

  let pendingName = null
  for (const line of lines) {
    const name = LABEL_NAME.exec(line)
    const labelled = LABEL_ID.exec(line)

    if (name && labelled) {
      add(labelled[1], name[1].replace(/[,;]?\s*Account ID\s*:.*$/i, '').trim())
      pendingName = null
      continue
    }

    if (name) {
      pendingName = name[1]
      continue
    }

    if (labelled) {
      add(labelled[1], pendingName)
      pendingName = null
      continue
    }

    const found = ACCOUNT_ID.exec(line)
    if (found) {
      add(found[1], line.replace(found[0], ' ').replace(/Account ID\s*:/i, ' '))
    }
  }

  return [...accounts].map(([id, name]) => ({ id, name }))
}

export function pickAccount({ accounts, accountId, answer }) {
  if (accountId) {
    const id = String(accountId).toLowerCase()
    return accounts.find((account) => account.id === id) ?? { id, name: null }
  }
  if (accounts.length === 0) {
    return null
  }
  if (accounts.length === 1) {
    return accounts[0]
  }
  if (answer === undefined || answer === null || String(answer).trim() === '') {
    return null
  }
  const index = Number(String(answer).trim())
  if (!Number.isInteger(index) || index < 1 || index > accounts.length) {
    return null
  }
  return accounts[index - 1]
}
