export function extractJson(text) {
  const clean = String(text ?? '').replace(/\u001b\[[0-9;]*m/g, '')
  for (const [open, close] of [
    ['[', ']'],
    ['{', '}'],
  ]) {
    let start = clean.indexOf(open)
    while (start >= 0) {
      const end = clean.lastIndexOf(close)
      if (end > start) {
        try {
          return JSON.parse(clean.slice(start, end + 1))
        } catch {
          start = clean.indexOf(open, start + 1)
          continue
        }
      }
      break
    }
  }
  throw new Error('no JSON value found in command output')
}
