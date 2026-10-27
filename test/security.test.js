const test = require('node:test')
const assert = require('node:assert/strict')

const security = require('../src/config/security')
const User = require('../src/models/User')
const { ensureDefaultAdmin } = require('../src/utils/defaultAdmin')

test('production security validation rejects placeholder JWT and admin credentials', () => {
  const saved = { ...process.env }
  try {
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = 'replace-with-a-long-random-secret'
    process.env.ADMIN_PHONE = '0788000000'
    process.env.ADMIN_NAME = 'Admin'
    process.env.ADMIN_PIN = '12345678'
    assert.throws(() => security.validateSecurityConfig(), /JWT_SECRET/)
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  }
})

test('default admin bootstrap never overwrites an existing account', async () => {
  const originalFindOne = User.findOne
  const originalCreate = User.create
  const saved = { ...process.env }
  const existing = { _id: 'existing-admin', pinHash: 'unchanged' }
  try {
    process.env.ADMIN_PHONE = '0788000000'
    process.env.ADMIN_NAME = 'Admin'
    process.env.ADMIN_PIN = 'a-safe-test-password'
    User.findOne = async () => existing
    User.create = async () => { throw new Error('must not create') }
    assert.equal(await ensureDefaultAdmin(), existing)
  } finally {
    User.findOne = originalFindOne
    User.create = originalCreate
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  }
})
