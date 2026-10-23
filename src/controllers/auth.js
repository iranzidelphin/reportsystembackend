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

exports.logout = asyncHandler(async (req, res) => {
  await log(req.user, 'LOGOUT', `${req.user.name} logged out`)
  res.json({ success: true, message: 'Logged out' })
})
