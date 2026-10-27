const { z } = require('zod')
const mongoose = require('mongoose')
const Transaction = require('../models/Transaction')
const Product = require('../models/Product')
const { asyncHandler, log, dateFilter, statusFor } = require('../utils')

const rule = z.object({
  productId: z.string().optional(), productName: z.string().trim().min(1).optional(),
  productOrService: z.string().trim().min(1).optional(), serviceOrProduct: z.string().trim().min(1).optional(),
  customerName: z.string().trim().max(160).optional().default(''),
  quantity: z.coerce.number().int().min(1).default(1), unitPrice: z.coerce.number().min(0).optional(),
  paidAmount: z.coerce.number().min(0), cashOut: z.coerce.number().min(0).optional().default(0),
  remainingAmount: z.coerce.number().min(0), paymentMethod: z.enum(['CASH', 'MOMO']),
  description: z.string().max(500).optional().default(''), notes: z.string().max(500).optional().default(''),
  transactionDate: z.coerce.date().optional(),
}).refine((v) => v.productId || v.productName || v.productOrService || v.serviceOrProduct, { message: 'Product is required', path: ['productId'] })
const batchRule = z.object({
  customerName: z.string().trim().max(160).optional().default(''),
  paymentMethod: z.enum(['CASH', 'MOMO']),
  transactionDate: z.coerce.date().optional(),
  items: z.array(z.object({
    productId: z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), 'Invalid product'), quantity: z.coerce.number().int().min(1),
    unitPrice: z.coerce.number().min(0),
  })).min(1).max(100),
})

const makeData = async (v, req, session = null) => {
  let product = null
  if (v.productId) {
    product = await Product.findById(v.productId).session(session)
    if (!product || product.status !== 'ACTIVE') throw Object.assign(new Error('Select an active product'), { status: 400 })
  }
  const name = product?.name || v.productName || v.productOrService || v.serviceOrProduct
  const unitPrice = v.unitPrice ?? product?.sellingPrice ?? (v.paidAmount + v.remainingAmount)
  const unitCost = product ? Number(product.costPrice || 0) : (v.quantity ? Number(v.cashOut || 0) / v.quantity : 0)
  const totalAmount = unitPrice * v.quantity
  const date = v.transactionDate || new Date()
  return { customerName: v.customerName, productId: product?._id || null, productOrService: name, serviceOrProduct: name,
    category: product?.category || '', quantity: v.quantity, unitPrice, unitCost, totalAmount,
    paidAmount: v.paidAmount, cashOut: v.cashOut, cashIn: v.paidAmount - v.cashOut,
    remainingAmount: v.remainingAmount, paymentMethod: v.paymentMethod,
    paymentStatus: statusFor(totalAmount, v.paidAmount), notes: v.description || v.notes,
    saleDate: date, transactionDate: date }
}
const adjustStock = async (productId, amount, session = null) => {
  if (!productId || !amount) return true
  if (amount < 0) {
    const product = await Product.findOneAndUpdate({ _id: productId, status: 'ACTIVE', quantity: { $gte: -amount } }, { $inc: { quantity: amount } }, { new: true, session })
    return Boolean(product)
  }
  await Product.updateOne({ _id: productId }, { $inc: { quantity: amount } }, { session })
  return true
}
const isAdmin = (user) => ['ADMIN', 'OWNER'].includes(user.role)
const shopScope = (req, query = {}) => isAdmin(req.user) ? query : { ...query, $or: [{ staff: req.user._id }, { createdBy: req.user._id }] }
const ownsTransaction = (req, row) => String(row?.createdBy || row?.staff || '') === String(req.user._id)

exports.create = asyncHandler(async (req, res) => {
  const parsed = rule.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.issues })
  let transaction
  const session = await mongoose.startSession()
  try { await session.withTransaction(async () => {
    const data = await makeData(parsed.data, req, session)
    if (data.productId && !await adjustStock(data.productId, -data.quantity, session)) throw Object.assign(new Error('Not enough stock available for this sale'), { status: 409 })
    ;[transaction] = await Transaction.create([{ ...data, staff: req.user._id, createdBy: req.user._id }], { session })
  }) } finally { await session.endSession() }
  await log(req.user, 'CREATE_TRANSACTION', `Created transaction for ${transaction.serviceOrProduct}`)
  res.status(201).json({ success: true, message: 'Transaction created successfully', data: transaction })
})

exports.createBatch = asyncHandler(async (req, res) => {
  const parsed = batchRule.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.issues })
  const { customerName, paymentMethod, transactionDate, items } = parsed.data
  let created = []
  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      const data = []
      for (const item of items) {
      const product = await Product.findById(item.productId).session(session)
      if (!product || product.status !== 'ACTIVE') throw Object.assign(new Error('One or more selected products are unavailable'), { status: 400 })
      const totalAmount = item.unitPrice * item.quantity
      const stock = await Product.findOneAndUpdate(
        { _id: product._id, status: 'ACTIVE', quantity: { $gte: item.quantity } },
        { $inc: { quantity: -item.quantity } },
        { new: true, session },
      )
      if (!stock) throw Object.assign(new Error(`Not enough stock for ${product.name}`), { status: 409 })
      const costTotal = Number(product.costPrice || 0) * item.quantity
      const date = transactionDate || new Date()
      data.push({ customerName, productId: product._id, productOrService: product.name, serviceOrProduct: product.name,
        category: product.category || '', quantity: item.quantity, unitPrice: item.unitPrice, unitCost: Number(product.costPrice || 0), totalAmount,
        paidAmount: totalAmount, cashOut: costTotal, cashIn: totalAmount - costTotal,
        remainingAmount: 0, paymentMethod, paymentStatus: statusFor(totalAmount, totalAmount),
        saleDate: date, transactionDate: date, staff: req.user._id, createdBy: req.user._id })
      }
      created = await Transaction.create(data, { session })
    })
  } finally { await session.endSession() }
  await Promise.all(created.map((row) => log(req.user, 'CREATE_TRANSACTION', `Created transaction for ${row.serviceOrProduct}`)))
  res.status(201).json({ success: true, message: 'Sale recorded successfully', data: created })
})

exports.list = asyncHandler(async (req, res) => {
  const { search, paymentMethod, productId } = req.query
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1))
  const limit = Math.max(1, Math.min(1000, Number.parseInt(req.query.limit, 10) || 20))
  let query = shopScope(req, { ...dateFilter(req.query) })
  if (paymentMethod) query.paymentMethod = paymentMethod
  if (productId && mongoose.Types.ObjectId.isValid(productId)) query.productId = productId
  if (search) {
    const terms = [{ serviceOrProduct: new RegExp(search, 'i') }, { productOrService: new RegExp(search, 'i') }, { notes: new RegExp(search, 'i') }]
    query = query.$or ? { $and: [query, { $or: terms }] } : { ...query, $or: terms }
  }
  const [data, total] = await Promise.all([Transaction.find(query).sort({ transactionDate: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('staff', 'name fullName phoneNumber role').populate('productId', 'name sku category costPrice brand location unit description'), Transaction.countDocuments(query)])
  res.json({ success: true, data, meta: { page, limit, total, pages: Math.ceil(total / limit) } })
})
exports.get = asyncHandler(async (req, res) => {
  const data = await Transaction.findOne(shopScope(req, { _id: req.params.id })).populate('staff', 'name fullName phoneNumber role').populate('productId', 'name sku category costPrice')
  if (!data) return res.status(404).json({ success: false, message: 'Transaction not found' })
  res.json({ success: true, data })
})
exports.update = asyncHandler(async (req, res) => {
  const parsed = rule.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.issues })
  const existing = await Transaction.findOne(shopScope(req, { _id: req.params.id }))
  if (!existing) return res.status(404).json({ success: false, message: 'Transaction not found' })
  if (!ownsTransaction(req, existing)) return res.status(403).json({ success: false, message: 'You can only edit rows you personally created.' })
  let updated
  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      const data = await makeData(parsed.data, req, session)
      if (existing.productId) await adjustStock(existing.productId, existing.quantity, session)
      if (data.productId && !await adjustStock(data.productId, -data.quantity, session)) throw Object.assign(new Error('Not enough stock available for this sale'), { status: 409 })
      updated = await Transaction.findByIdAndUpdate(existing._id, data, { new: true, session }).populate('staff', 'name fullName phoneNumber role').populate('productId', 'name sku category costPrice')
    })
  } finally { await session.endSession() }
  await log(req.user, 'UPDATE_TRANSACTION', `Updated transaction ${updated.serviceOrProduct}`)
  res.json({ success: true, message: 'Transaction updated successfully', data: updated })
})
exports.remove = asyncHandler(async (req, res) => {
  const existing = await Transaction.findOne(shopScope(req, { _id: req.params.id }))
  if (!existing) return res.status(404).json({ success: false, message: 'Transaction not found' })
  if (!ownsTransaction(req, existing)) return res.status(403).json({ success: false, message: 'You can only delete rows you personally created.' })
  const session = await mongoose.startSession()
  try { await session.withTransaction(async () => {
    await Transaction.findByIdAndDelete(existing._id, { session })
    if (existing.productId) await adjustStock(existing.productId, existing.quantity, session)
  }) } finally { await session.endSession() }
  await log(req.user, 'DELETE_TRANSACTION', `Deleted transaction ${existing.serviceOrProduct}`)
  res.json({ success: true, message: 'Transaction deleted' })
})
