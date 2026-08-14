const bcrypt = require('bcryptjs')
const User = require('../models/User')

function adminConfig() {
  return {
    phoneNumber: process.env.ADMIN_PHONE || '0788721005',
    pin: process.env.ADMIN_PIN || '1234',
    name: process.env.ADMIN_NAME || 'System Admin',
  }
}

function isDefaultAdmin(user) {
  const { phoneNumber } = adminConfig()
  return Boolean(user && user.phoneNumber === phoneNumber && user.role === 'ADMIN')
}

async function ensureDefaultAdmin() {
  const { phoneNumber, pin, name } = adminConfig()
  const pinHash = await bcrypt.hash(pin, 12)
  const user = await User.findOneAndUpdate(
    { phoneNumber },
    { fullName: name, name, phoneNumber, pinHash, role: 'ADMIN', status: 'ACTIVE' },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
  return user
}

module.exports = { adminConfig, ensureDefaultAdmin, isDefaultAdmin }
