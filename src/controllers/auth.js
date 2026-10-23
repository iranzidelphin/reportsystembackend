const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { z } = require('zod')
const User = require('../models/User')
const { asyncHandler, log } = require('../utils')

const safe = (user) => ({
  id: user._id,
  fullName: user.fullName,
  name: user.name,
  phoneNumber: user.phoneNumber,
  role: user.role,
  status: user.status,
  lastLogin: user.lastLogin,
  createdBy: user.createdBy,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
})

exports.login = asyncHandler(async (req, res) => {
  const parsed = z.object({
    phoneNumber: z.string().trim().min(7),
    password: z.string().min(1).optional(),
    pin: z.string().min(1).optional(),
  }).safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.issues })
  }

  const query = parsed.data.phoneNumber ? { phoneNumber: parsed.data.phoneNumber } : {}
  const credential = parsed.data.password || parsed.data.pin
  if (!credential) return res.status(400).json({ success: false, message: 'Password is required.' })
  const users = await User.find(query).select('+passwordHash +pinHash')
  const user = users.find((item) => item.status === 'ACTIVE' && bcrypt.compareSync(credential, item.passwordHash || item.pinHash || ''))

  if (!user) return res.status(401).json({ success: false, message: 'Invalid phone number or password.' })

  user.lastLogin = new Date()
  await user.save()
  await log(user, 'LOGIN', `${user.name} logged in`)

  const secret = process.env.JWT_SECRET || 'change_this_local_shop_report_secret'
  const token = jwt.sign({ id: user._id, role: user.role }, secret, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' })

  res.json({ success: true, message: 'Login successful', data: { token, user: safe(user), permissions: user.role } })
})

exports.me = asyncHandler(async (req, res) => res.json({ success: true, data: safe(req.user) }))

exports.changePassword = asyncHandler(async (req, res) => {
  const parsed = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
    confirmPassword: z.string().min(8).max(128),
  }).refine((values) => values.newPassword === values.confirmPassword, {
    message: 'New passwords do not match.',
    path: ['confirmPassword'],
  }).safeParse(req.body)

  if (!parsed.success) {
    const mismatch = parsed.error.issues.some((issue) => issue.path.includes('confirmPassword'))
    return res.status(400).json({
      success: false,
      message: mismatch ? 'New passwords do not match.' : 'Enter your current password and a new password of 8 to 128 characters.',
      errors: parsed.error.issues,
    })
  }

  const user = await User.findById(req.user._id).select('+passwordHash +pinHash')
  const storedHash = user?.passwordHash || user?.pinHash
  if (!user || !storedHash || !await bcrypt.compare(parsed.data.currentPassword, storedHash)) {
    return res.status(400).json({ success: false, message: 'Current password is incorrect.' })
  }

  user.passwordHash = await bcrypt.hash(parsed.data.newPassword, 12)
  user.pinHash = undefined
  await user.save()
  await log(user, 'CHANGE_PASSWORD', 'Updated account password')

  res.json({ success: true, message: 'Password updated successfully.' })
})

exports.logout = asyncHandler(async (req, res) => {
  await log(req.user, 'LOGOUT', `${req.user.name} logged out`)
  res.json({ success: true, message: 'Logged out' })
})
