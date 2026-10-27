const { z } = require('zod')
const Product = require('../models/Product')
const ProductOption = require('../models/ProductOption')
const { asyncHandler, log } = require('../utils')

const rule = z.object({
  name: z.string().trim().min(1), sku: z.string().trim().optional().default(''),
  category: z.string().trim().optional().default(''), brand: z.string().trim().optional().default(''),
  description: z.string().trim().optional().default(''), unit: z.string().trim().optional().default('piece'),
  costPrice: z.coerce.number().min(0).default(0), sellingPrice: z.coerce.number().min(0),
  quantity: z.coerce.number().int().min(0), lowStockLevel: z.coerce.number().int().min(0).default(5),
  location: z.string().trim().min(1), supplier: z.string().trim().optional().default(''),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'), notes: z.string().trim().optional().default(''),
})

exports.list = asyncHandler(async (req, res) => {
  const { search, category, location, status, lowStock } = req.query
  const query = {}
  if (category) query.category = category
  if (location) query.location = location
  if (status) query.status = status
  if (lowStock === 'true') query.$expr = { $lte: ['$quantity', '$lowStockLevel'] }
  if (search) query.$or = ['name', 'sku', 'brand', 'category', 'location'].map((key) => ({ [key]: new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }))
  const data = await Product.find(query).sort({ name: 1 }).populate('addedBy', 'name fullName').populate('lastUpdatedBy', 'name fullName')
  res.json({ success: true, data })
})

const optionFields = { category: 'category', brand: 'brand', model: 'description' }
exports.options = asyncHandler(async (req, res) => {
  const [values, saved] = await Promise.all([Product.aggregate([
    { $project: { category: 1, brand: 1, model: '$description' } },
    { $group: { _id: null, categories: { $addToSet: '$category' }, brands: { $addToSet: '$brand' }, models: { $addToSet: '$model' } } },
    { $project: { _id: 0, categories: 1, brands: 1, models: 1 } },
  ]), ProductOption.find().select('type name').lean()])
  const data = values[0] || { categories: [], brands: [], models: [] }
  for (const option of saved) {
    const key = ({ category: 'categories', brand: 'brands', model: 'models' })[option.type]
    if (data[key] && !data[key].some((name) => name.toLocaleLowerCase() === option.name.toLocaleLowerCase())) data[key].push(option.name)
  }
  for (const key of Object.keys(data)) data[key] = data[key].filter(Boolean).sort((a, b) => a.localeCompare(b))
  res.json({ success: true, data })
})

exports.createOption = asyncHandler(async (req, res) => {
  const { type, name } = req.body || {}
  if (!optionFields[type] || typeof name !== 'string' || !name.trim()) return res.status(400).json({ success: false, message: 'Choose an option type and enter a name.' })
  const normalizedName = name.trim()
  const exists = await ProductOption.findOne({ type, name: normalizedName }).collation({ locale: 'en', strength: 2 })
  if (exists) return res.status(409).json({ success: false, message: 'That option already exists.' })
  try {
    const data = await ProductOption.create({ type, name: normalizedName, createdBy: req.user._id })
    await log(req.user, 'CREATE_PRODUCT_OPTION', `Created ${type} option “${normalizedName}”`)
    res.status(201).json({ success: true, data })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'That option already exists.' })
    throw error
  }
})

exports.updateOption = asyncHandler(async (req, res) => {
  const field = optionFields[req.params.field]
  if (!field) return res.status(400).json({ success: false, message: 'Choose category, brand, or model.' })
  const { name, newName } = req.body || {}
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ success: false, message: 'The existing option name is required.' })
  if (newName !== null && newName !== undefined && (typeof newName !== 'string' || !newName.trim())) return res.status(400).json({ success: false, message: 'Enter a new name or use delete.' })
  const currentName = name.trim()
  const nextName = newName == null ? null : newName.trim()
  const filter = { [field]: currentName }
  if (nextName && nextName.toLocaleLowerCase() !== currentName.toLocaleLowerCase()) {
    const duplicate = await Product.exists({ [field]: new RegExp(`^${nextName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
    const savedDuplicate = await ProductOption.findOne({ type: req.params.field, name: nextName }).collation({ locale: 'en', strength: 2 })
    if (duplicate || savedDuplicate) return res.status(409).json({ success: false, message: 'An option with that name already exists.' })
  }
  const result = nextName
    ? await Product.updateMany(filter, { $set: { [field]: nextName, lastUpdatedBy: req.user._id } })
    : await Product.updateMany(filter, { $set: { [field]: '', lastUpdatedBy: req.user._id } })
  if (nextName) {
    await ProductOption.updateMany({ type: req.params.field, name: currentName }, { $set: { name: nextName } })
  } else {
    await ProductOption.deleteMany({ type: req.params.field, name: currentName })
  }
  await log(req.user, nextName ? 'RENAME_PRODUCT_OPTION' : 'DELETE_PRODUCT_OPTION', `${nextName ? 'Renamed' : 'Removed'} ${req.params.field} “${currentName}” on ${result.modifiedCount} product(s)`)
  res.json({ success: true, data: { modifiedCount: result.modifiedCount, name: nextName } })
})

exports.get = asyncHandler(async (req, res) => {
  const data = await Product.findOne({ _id: req.params.id, }).populate('addedBy', 'name fullName').populate('lastUpdatedBy', 'name fullName')
  if (!data) return res.status(404).json({ success: false, message: 'Product not found' })
  res.json({ success: true, data })
})

exports.create = asyncHandler(async (req, res) => {
  const parsed = rule.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.issues })
  try {
    const data = await Product.create({ ...parsed.data, sku: parsed.data.sku || undefined, addedBy: req.user._id, lastUpdatedBy: req.user._id })
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
    const existing = await Product.findById(req.params.id)
    if (!existing) return res.status(404).json({ success: false, message: 'Product not found' })
    if (existing.quantity !== parsed.data.quantity) return res.status(409).json({ success: false, message: 'Stock quantity cannot be changed from product editing. Use a stock import or adjustment workflow.' })
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
