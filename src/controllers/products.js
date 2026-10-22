const { z } = require('zod')
const Product = require('../models/Product')
const { asyncHandler, log } = require('../utils')

const rule = z.object({
  name: z.string().trim().min(1), sku: z.string().trim().optional().default(''),
  category: z.string().trim().optional().default(''), brand: z.string().trim().optional().default(''),
  description: z.string().trim().optional().default(''), unit: z.string().trim().optional().default('piece'),
  costPrice: z.coerce.number().min(0).default(0), sellingPrice: z.coerce.number().min(0),
  quantity: z.coerce.number().int().min(0), lowStockLevel: z.coerce.number().int().min(0).default(5),
  location: z.string().trim().min(1), supplier: z.string().trim().optional().default(''),
  branchId: z.string().optional().or(z.literal('')),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'), notes: z.string().trim().optional().default(''),
})

exports.list = asyncHandler(async (req, res) => {
  const { search, category, location, status, lowStock } = req.query
  const query = {}
  if (req.query.branchId) query.branchId = req.query.branchId
  if (category) query.category = category
  if (location) query.location = location
  if (status) query.status = status
  if (lowStock === 'true') query.$expr = { $lte: ['$quantity', '$lowStockLevel'] }
  if (search) query.$or = ['name', 'sku', 'brand', 'category', 'location'].map((key) => ({ [key]: new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }))
  let data = await Product.find(query).sort({ name: 1 }).populate('addedBy', 'name fullName').populate('lastUpdatedBy', 'name fullName').populate('branchId', 'name status')
  if (status === 'ACTIVE') data = data.filter((product) => !product.branchId || product.branchId.status === 'ACTIVE')
  res.json({ success: true, data })
})

exports.get = asyncHandler(async (req, res) => {
  const data = await Product.findById(req.params.id).populate('addedBy', 'name fullName').populate('lastUpdatedBy', 'name fullName').populate('branchId', 'name status')
  if (!data) return res.status(404).json({ success: false, message: 'Product not found' })
  res.json({ success: true, data })
})

exports.create = asyncHandler(async (req, res) => {
  const parsed = rule.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.issues })
  try {
    const branchId = parsed.data.branchId || undefined
    if (branchId) {
      const Branch = require('../models/Branch')
      if (!await Branch.exists({ _id: branchId, status: 'ACTIVE' })) return res.status(400).json({ success: false, message: 'Select an active branch' })
    }
    const data = await Product.create({ ...parsed.data, branchId, sku: parsed.data.sku || undefined, addedBy: req.user._id, lastUpdatedBy: req.user._id })
    await log(req.user, 'CREATE_PRODUCT', `Created product ${data.name}`)
    res.status(201).json({ success: true, data })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'SKU already exists' })
    throw error
  }
})

exports.update = asyncHandler(async (req, res) => {
  const parsed = rule.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.issues })
  try {
    if (parsed.data.branchId) {
      const Branch = require('../models/Branch')
      const current = await Product.findById(req.params.id).select('branchId')
      const unchangedBranch = current?.branchId && String(current.branchId) === parsed.data.branchId
      if (!await Branch.exists({ _id: parsed.data.branchId, ...(unchangedBranch ? {} : { status: 'ACTIVE' }) })) return res.status(400).json({ success: false, message: 'Select an active branch' })
      if (current && !unchangedBranch) {
        const Transaction = require('../models/Transaction')
        const Expense = require('../models/Expense')
        const [product, hasSales, hasImports] = await Promise.all([Product.findById(req.params.id).select('quantity'), Transaction.exists({ productId: req.params.id }), Expense.exists({ productId: req.params.id })])
        if (Number(product?.quantity || 0) > 0 || hasSales || hasImports) return res.status(409).json({ success: false, message: 'This product has stock or history. Use a stock transfer to move it to another branch.' })
      }
    }
    const update = { $set: { ...parsed.data, lastUpdatedBy: req.user._id } }
    if (!parsed.data.sku) {
      delete update.$set.sku
      update.$unset = { sku: 1 }
    }
    const data = await Product.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
    if (!data) return res.status(404).json({ success: false, message: 'Product not found' })
    await log(req.user, 'UPDATE_PRODUCT', `Updated product ${data.name}`)
    res.json({ success: true, data })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'SKU already exists' })
    throw error
  }
})

exports.remove = asyncHandler(async (req, res) => {
  const Transaction = require('../models/Transaction')
  const Expense = require('../models/Expense')
  const product = await Product.findById(req.params.id)
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' })
  const [sales, imports] = await Promise.all([Transaction.exists({ productId: product._id }), Expense.exists({ productId: product._id })])
  if (sales || imports) return res.status(409).json({ success: false, message: 'This product has sales or import history. Set it to inactive instead.' })
  await product.deleteOne()
  await log(req.user, 'DELETE_PRODUCT', `Deleted product ${product.name}`)
  res.json({ success: true, message: 'Product deleted' })
})
