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

const makeData = async (v, req) => {
  let product = null
  if (v.productId) {
    product = await Product.findById(v.productId)
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
const adjustStock = async (productId, amount) => {
  if (!productId || !amount) return true
  if (amount < 0) {
    const product = await Product.findOneAndUpdate({ _id: productId, status: 'ACTIVE', quantity: { $gte: -amount } }, { $inc: { quantity: amount } }, { new: true })
    return Boolean(product)
  }
  await Product.updateOne({ _id: productId }, { $inc: { quantity: amount } })
  return true
}
const shopScope = (_req, query = {}) => query
const ownsTransaction = (req, row) => String(row?.createdBy || row?.staff || '') === String(req.user._id)

exports.create = asyncHandler(async (req, res) => {
  const parsed = rule.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.issues })
  const data = await makeData(parsed.data, req)
  if (data.productId && !await adjustStock(data.productId, -data.quantity)) return res.status(409).json({ success: false, message: 'Not enough stock available for this sale' })
  let transaction
  try { transaction = await Transaction.create({ ...data, staff: req.user._id, createdBy: req.user._id }) } catch (error) {
    if (data.productId) await adjustStock(data.productId, data.quantity)
    throw error
  }
  await log(req.user, 'CREATE_TRANSACTION', `Created transaction for ${transaction.serviceOrProduct}`)
  res.status(201).json({ success: true, message: 'Transaction created successfully', data: transaction })
})

exports.createBatch = asyncHandler(async (req, res) => {
  const parsed = batchRule.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.issues })
  const { customerName, paymentMethod, transactionDate, items } = parsed.data
  const debited = []
  let created = []
  try {
    const data = []
    for (const item of items) {
      const product = await Product.findById(item.productId)
      if (!product || product.status !== 'ACTIVE') throw Object.assign(new Error('One or more selected products are unavailable'), { status: 400 })
      const totalAmount = item.unitPrice * item.quantity
      const stock = await Product.findOneAndUpdate(
        { _id: product._id, status: 'ACTIVE', quantity: { $gte: item.quantity } },
        { $inc: { quantity: -item.quantity } },
        { new: true },
      )
      if (!stock) throw Object.assign(new Error(`Not enough stock for ${product.name}`), { status: 409 })
      debited.push({ productId: product._id, quantity: item.quantity })
      const costTotal = Number(product.costPrice || 0) * item.quantity
      const date = transactionDate || new Date()
      data.push({ customerName, productId: product._id, productOrService: product.name, serviceOrProduct: product.name,
        category: product.category || '', quantity: item.quantity, unitPrice: item.unitPrice, unitCost: Number(product.costPrice || 0), totalAmount,
        paidAmount: totalAmount, cashOut: costTotal, cashIn: totalAmount - costTotal,
        remainingAmount: 0, paymentMethod, paymentStatus: statusFor(totalAmount, totalAmount),
        saleDate: date, transactionDate: date, staff: req.user._id, createdBy: req.user._id })
    }
    for (const row of data) created.push(await Transaction.create(row))
  } catch (error) {
    if (created.length) await Transaction.deleteMany({ _id: { $in: created.map((row) => row._id) } })
    for (const debit of debited) await Product.updateOne({ _id: debit.productId }, { $inc: { quantity: debit.quantity } })
    throw error
  }
  await Promise.all(created.map((row) => log(req.user, 'CREATE_TRANSACTION', `Created transaction for ${row.serviceOrProduct}`)))
  res.status(201).json({ success: true, message: 'Sale recorded successfully', data: created })
})

exports.list = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search, paymentMethod } = req.query
  const query = shopScope(req, { ...dateFilter(req.query) })
  if (req.query.dashboard === 'true' && !['ADMIN', 'OWNER'].includes(req.user.role)) {
    query.$or = [{ staff: req.user._id }, { createdBy: req.user._id }]
  }
  if (paymentMethod) query.paymentMethod = paymentMethod
  if (search) query.$or = [{ serviceOrProduct: new RegExp(search, 'i') }, { productOrService: new RegExp(search, 'i') }, { notes: new RegExp(search, 'i') }]
  const [data, total] = await Promise.all([Transaction.find(query).sort({ transactionDate: -1, createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)).populate('staff', 'name fullName phoneNumber role').populate('productId', 'name sku category costPrice brand location unit description'), Transaction.countDocuments(query)])
  res.json({ success: true, data, meta: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) } })
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
  const data = await makeData(parsed.data, req)
  if (existing.productId) await adjustStock(existing.productId, existing.quantity)
  if (data.productId && !await adjustStock(data.productId, -data.quantity)) {
    if (existing.productId) await adjustStock(existing.productId, -existing.quantity)
    return res.status(409).json({ success: false, message: 'Not enough stock available for this sale' })
  }
  try {
    const updated = await Transaction.findByIdAndUpdate(existing._id, data, { new: true }).populate('staff', 'name fullName phoneNumber role').populate('productId', 'name sku category costPrice')
    await log(req.user, 'UPDATE_TRANSACTION', `Updated transaction ${updated.serviceOrProduct}`)
    res.json({ success: true, message: 'Transaction updated successfully', data: updated })
  } catch (error) {
    if (data.productId) await adjustStock(data.productId, data.quantity)
    if (existing.productId) await adjustStock(existing.productId, -existing.quantity)
    throw error
  }
})
exports.remove = asyncHandler(async (req, res) => {
  const existing = await Transaction.findOne(shopScope(req, { _id: req.params.id }))
  if (!existing) return res.status(404).json({ success: false, message: 'Transaction not found' })
  if (!ownsTransaction(req, existing)) return res.status(403).json({ success: false, message: 'You can only delete rows you personally created.' })
  await Transaction.findByIdAndDelete(existing._id)
  if (existing.productId) await adjustStock(existing.productId, existing.quantity)
  await log(req.user, 'DELETE_TRANSACTION', `Deleted transaction ${existing.serviceOrProduct}`)
  res.json({ success: true, message: 'Transaction deleted' })
})
