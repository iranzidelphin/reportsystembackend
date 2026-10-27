const bcrypt = require('bcryptjs')
const User = require('../models/User')
const { isPlaceholder } = require('../config/security')

function adminConfig() {
  return {
    phoneNumber: process.env.ADMIN_PHONE,
    pin: process.env.ADMIN_PIN,
    name: process.env.ADMIN_NAME,
  }
}

function isDefaultAdmin(user) {
  const { phoneNumber } = adminConfig()
  return Boolean(user && user.phoneNumber === phoneNumber && user.role === 'ADMIN')
}

async function ensureDefaultAdmin() {
  const { phoneNumber, pin, name } = adminConfig()
  if (!phoneNumber || !pin || !name) {
    if (process.env.NODE_ENV === 'production') throw new Error('Admin bootstrap credentials are required in production.')
    return null
  }
  const existing = await User.findOne({ phoneNumber })
  if (existing) return existing
  if (process.env.NODE_ENV === 'production' && (isPlaceholder(pin) || String(pin).length < 8)) throw new Error('ADMIN_PIN must be a non-placeholder value of at least 8 characters in production.')
  return User.create({ fullName: name, name, phoneNumber, passwordHash: await bcrypt.hash(pin, 12), role: 'ADMIN', status: 'ACTIVE' })
}

module.exports = { adminConfig, ensureDefaultAdmin, isDefaultAdmin }
