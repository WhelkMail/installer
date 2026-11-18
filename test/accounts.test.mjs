import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAccounts, pickAccount } from '../src/accounts.mjs'

const TABLE_OUTPUT = [
  'Getting User settings...',
  '👋 You are logged in with an OAuth Token, associated with the email mario@example.com.',
  '┌──────────────────┬──────────────────────────────────┐',
  '│ Account Name     │ Account ID                       │',
  '├──────────────────┼──────────────────────────────────┤',
  '│ Personal Mail    │ 0123456789abcdef0123456789abcdef │',
  '│ Work Mail        │ fedcba9876543210fedcba9876543210 │',
  '└──────────────────┴──────────────────────────────────┘',
].join('\n')

test('parses the wrangler whoami table with names', () => {
  const accounts = parseAccounts(TABLE_OUTPUT)
  assert.deepEqual(accounts, [
    { id: '0123456789abcdef0123456789abcdef', name: 'Personal Mail' },
    { id: 'fedcba9876543210fedcba9876543210', name: 'Work Mail' },
  ])
})

test('parses the labelled whoami format', () => {
  const accounts = parseAccounts(
    ['Account Name: Personal Mail', 'Account ID: 0123456789abcdef0123456789abcdef'].join('\n'),
  )
  assert.deepEqual(accounts, [
    { id: '0123456789abcdef0123456789abcdef', name: 'Personal Mail' },
  ])
})

test('parses name and id on the same line', () => {
  const accounts = parseAccounts(
    'Account Name: Personal Mail, Account ID: 0123456789abcdef0123456789abcdef',
  )
  assert.deepEqual(accounts, [
    { id: '0123456789abcdef0123456789abcdef', name: 'Personal Mail' },
  ])
})

test('ignores output without account ids', () => {
  assert.deepEqual(parseAccounts('You are logged in with an API Token.'), [])
})

test('deduplicates repeated account ids', () => {
  const accounts = parseAccounts(`${TABLE_OUTPUT}\n${TABLE_OUTPUT}`)
  assert.equal(accounts.length, 2)
})

test('automatically picks a single account', () => {
  const accounts = [{ id: 'a'.repeat(32), name: 'Only' }]
  assert.deepEqual(pickAccount({ accounts }), accounts[0])
})

test('never guesses when several accounts are available', () => {
  const accounts = [
    { id: 'a'.repeat(32), name: 'One' },
    { id: 'b'.repeat(32), name: 'Two' },
  ]
  assert.equal(pickAccount({ accounts }), null)
  assert.equal(pickAccount({ accounts, answer: '' }), null)
  assert.equal(pickAccount({ accounts, answer: '0' }), null)
  assert.equal(pickAccount({ accounts, answer: '3' }), null)
  assert.equal(pickAccount({ accounts, answer: '1.5' }), null)
  assert.equal(pickAccount({ accounts, answer: '2' }), accounts[1])
})

test('honours an explicit account id', () => {
  const accounts = [
    { id: 'a'.repeat(32), name: 'One' },
    { id: 'b'.repeat(32), name: 'Two' },
  ]
  assert.deepEqual(pickAccount({ accounts, accountId: 'B'.repeat(32) }), accounts[1])
  assert.deepEqual(pickAccount({ accounts, accountId: 'c'.repeat(32) }), {
    id: 'c'.repeat(32),
    name: null,
  })
})
