const { z } = require('zod')
const Branch = require('../models/Branch')
const Product = require('../models/Product')
const Transaction = require('../models/Transaction')
const Expense = require('../models/Expense')
const { asyncHandler, log } = require('../utils')
const mongoose = require('mongoose')

const rule = z.object({
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().max(20).optional().default(''),
  address: z.string().trim().max(250).optional().default(''),
  phone: z.string().trim().max(30).optional().default(''),
  managerName: z.string().trim().max(100).optional().default(''),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
})

exports.list = asyncHandler(async (req, res) => {
  const branches = await Branch.find().sort({ status: 1, name: 1 }).lean()
  const data = await Promise.all(branches.map(async (branch) => {
    const [inventory, sales, imports] = await Promise.all([
      Product.aggregate([{ $match: { branchId: branch._id } }, { $group: { _id: null, products: { $sum: 1 }, units: { $sum: '$quantity' }, value: { $sum: { $multiply: ['$quantity', '$costPrice'] } }, lowStock: { $sum: { $cond: [{ $lte: ['$quantity', '$lowStockLevel'] }, 1, 0] } } } }]),
      Transaction.aggregate([{ $match: { branchId: branch._id } }, { $group: { _id: null, sales: { $sum: '$totalAmount' }, count: { $sum: 1 } } }]),
      Expense.countDocuments({ branchId: branch._id }),
    ])
    return { ...branch, inventory: inventory[0] || { products: 0, units: 0, value: 0, lowStock: 0 }, sales: sales[0] || { sales: 0, count: 0 }, importCount: imports }
  }))
  res.json({ success: true, data })
})

exports.create = asyncHandler(async (req, res) => {
  const parsed = rule.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.issues })
  try {
    const data = await Branch.create({ ...parsed.data, code: parsed.data.code || undefined, createdBy: req.user._id })
    await log(req.user, 'CREATE_BRANCH', `Created branch ${data.name}`)
    res.status(201).json({ success: true, data })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'Branch name or code already exists' })
    throw error
  }
})

exports.update = asyncHandler(async (req, res) => {
  const parsed = rule.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.issues })
  try {
    const update = { $set: parsed.data }
    if (!parsed.data.code) { delete update.$set.code; update.$unset = { code: 1 } }
    const data = await Branch.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
    if (!data) return res.status(404).json({ success: false, message: 'Branch not found' })
    await log(req.user, 'UPDATE_BRANCH', `Updated branch ${data.name}`)
    res.json({ success: true, data })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'Branch name or code already exists' })
    throw error
  }
})

exports.remove = asyncHandler(async (req, res) => {
  const data = await Branch.findById(req.params.id)
  if (!data) return res.status(404).json({ success: false, message: 'Branch not found' })
  const [products, transactions, imports] = await Promise.all([Product.exists({ branchId: data._id }), Transaction.exists({ branchId: data._id }), Expense.exists({ branchId: data._id })])
  if (products || transactions || imports) return res.status(409).json({ success: false, message: 'This branch has inventory or history. Set it inactive to preserve its records.' })
  await data.deleteOne()
  await log(req.user, 'DELETE_BRANCH', `Deleted branch ${data.name}`)
  res.json({ success: true, message: 'Branch deleted' })
})

exports.get = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid branch ID' })
  const branch = await Branch.findById(req.params.id)
  if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' })
  const [products, transactions, imports] = await Promise.all([
    Product.find({ branchId: branch._id }).sort({ name: 1 }),
    Transaction.find({ branchId: branch._id }).sort({ transactionDate: -1 }).limit(50).populate('productId', 'name sku').populate('staff', 'name fullName'),
    Expense.find({ branchId: branch._id }).sort({ expenseDate: -1 }).limit(50).populate('productId', 'name sku'),
  ])
  res.json({ success: true, data: { branch, products, transactions, imports } })
})
