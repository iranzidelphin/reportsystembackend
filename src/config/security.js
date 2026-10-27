const PLACEHOLDER_VALUES = new Set([
  'change_this_local_shop_report_secret',
  'replace-with-a-long-random-secret',
  '1234',
  '123456',
])

function isPlaceholder(value) {
  return !value || PLACEHOLDER_VALUES.has(String(value).trim().toLowerCase())
}

function validateSecurityConfig() {
  if (process.env.NODE_ENV !== 'production') return
  if (isPlaceholder(process.env.JWT_SECRET) || String(process.env.JWT_SECRET).length < 32) {
    throw new Error('JWT_SECRET must be a non-placeholder value of at least 32 characters in production.')
  }
  for (const key of ['ADMIN_PHONE', 'ADMIN_PIN', 'ADMIN_NAME']) {
    if (isPlaceholder(process.env[key])) throw new Error(`${key} must be configured in production.`)
  }
  if (String(process.env.ADMIN_PIN).length < 8) throw new Error('ADMIN_PIN must be at least 8 characters in production.')
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET
  if (isPlaceholder(secret)) throw new Error('JWT_SECRET is not configured.')
  return secret
}

module.exports = { isPlaceholder, validateSecurityConfig, jwtSecret }
