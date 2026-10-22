const mongoose = require('mongoose')
const { z } = require('zod')
const Product = require('../models/Product')
const Branch = require('../models/Branch')
const Transaction = require('../models/Transaction')
const Expense = require('../models/Expense')
const SyncReceipt = require('../models/SyncReceipt')
const { statusFor } = require('../utils')

const MAX_BATCH_SIZE = 40
const MAX_SALE_LINES = 50
const saleRule = z.object({
  customerName: z.string().trim().max(160).default('General'),
  paymentMethod: z.enum(['CASH', 'MOMO']),
  transactionDate: z.coerce.date(),
  items: z.array(z.object({
    productId: z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), 'Invalid product ID'),
    quantity: z.number().int().min(1).max(100000),
    unitPrice: z.number().min(0).max(100000000000),
  })).min(1).max(MAX_SALE_LINES),
})
const importRule = z.object({
  productId: z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), 'Invalid product ID'),
  stockQuantity: z.number().int().min(1).max(100000),
  description: z.string().trim().min(1).max(500),
  amount: z.number().positive().max(100000000000),
  paymentMethod: z.enum(['CASH', 'MOMO']),
  expenseDate: z.coerce.date(),
})
const operationRule = z.discriminatedUnion('kind', [
  z.object({ operationId: z.string().uuid(), kind: z.literal('sale'), payload: saleRule }),
  z.object({ operationId: z.string().uuid(), kind: z.literal('import'), payload: importRule }),
])
const withSession = (query, session) => session ? query.session(session) : query
const branchActive = async (product, session) => !product.branchId || Boolean(await withSession(Branch.exists({ _id: product.branchId, status: 'ACTIVE' }), session))
const stockSnapshot = async (productIds, session) => {
  const uniqueIds = [...new Set(productIds.filter((id) => mongoose.Types.ObjectId.isValid(id)).map(String))]
  const rows = await withSession(Product.find({ _id: { $in: uniqueIds } }).select('_id quantity location status'), session).lean()
  return rows.map((row) => ({ productId: String(row._id), quantity: row.quantity, location: row.location, status: row.status }))
}
const asPlain = (row) => row?.toObject ? row.toObject() : row

class OperationOutcomeError extends Error {
  constructor(result) {
    super(result.message || 'Operation could not be applied')
    this.result = result
  }
}

async function saveReceipt(session, operation, req, result) {
  await SyncReceipt.create([{
    operationId: operation.operationId,
    userId: req.user._id,
    deviceId: req.body.deviceId,
    kind: operation.kind,
    result,
  }], { session })
}

async function applySale(session, operation, req) {
  const { payload } = operation
  const records = []
  const touchedProductIds = []
  for (const item of payload.items) {
    const product = await Product.findById(item.productId).session(session)
    if (!product) return { status: 'error', retryable: false, message: 'A selected product no longer exists.', data: null, currentStock: await stockSnapshot([item.productId], session) }
    touchedProductIds.push(product._id)
    if (product.status !== 'ACTIVE' || !await branchActive(product, session)) {
      return { status: 'conflict', retryable: false, message: `${product.name} is inactive or its branch is inactive.`, data: null, currentStock: await stockSnapshot(touchedProductIds, session) }
    }
    const updated = await Product.findOneAndUpdate(
      { _id: product._id, status: 'ACTIVE', quantity: { $gte: item.quantity } },
      { $inc: { quantity: -item.quantity } },
      { new: true, session, runValidators: true },
    )
    if (!updated) {
      return { status: 'conflict', retryable: false, message: `Insufficient current stock for ${product.name}.`, data: null, currentStock: await stockSnapshot(touchedProductIds, session) }
    }
    const revenue = item.unitPrice * item.quantity
    const cost = Number(product.costPrice || 0) * item.quantity
    records.push({
      customerName: payload.customerName,
      productId: product._id,
      productOrService: product.name,
      serviceOrProduct: product.name,
      branchId: product.branchId || null,
      category: product.category || '',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      unitCost: Number(product.costPrice || 0),
      totalAmount: revenue,
      paidAmount: revenue,
      cashOut: cost,
      cashIn: revenue - cost,
      remainingAmount: 0,
      paymentMethod: payload.paymentMethod,
      paymentStatus: statusFor(revenue, revenue),
      saleDate: payload.transactionDate,
      transactionDate: payload.transactionDate,
      staff: req.user._id,
      createdBy: req.user._id,
    })
  }
  const created = await Transaction.create(records, { session })
  return { status: 'success', retryable: false, data: created.map(asPlain), currentStock: await stockSnapshot(touchedProductIds, session) }
}

async function applyImport(session, operation, req) {
  const { payload } = operation
  const product = await Product.findById(payload.productId).session(session)
  if (!product) return { status: 'error', retryable: false, message: 'The selected product no longer exists.', data: null, currentStock: [] }
  if (product.status !== 'ACTIVE' || !await branchActive(product, session)) {
    return { status: 'conflict', retryable: false, message: 'The selected product or its branch is inactive.', data: null, currentStock: await stockSnapshot([product._id], session) }
  }
  const updated = await Product.findByIdAndUpdate(
    product._id,
    { $inc: { quantity: payload.stockQuantity } },
    { new: true, session, runValidators: true },
  )
  const [expense] = await Expense.create([{
    description: payload.description,
    amount: payload.amount,
    paymentMethod: payload.paymentMethod,
    productId: product._id,
    branchId: product.branchId || null,
    stockQuantity: payload.stockQuantity,
    expenseDate: payload.expenseDate,
    date: payload.expenseDate,
    createdBy: req.user._id,
  }], { session })
  return { status: 'success', retryable: false, data: asPlain(expense), currentStock: [{ productId: String(updated._id), quantity: updated.quantity, location: updated.location, status: updated.status }] }
}

async function processOperation(operation, req) {
  const prior = await SyncReceipt.findOne({ operationId: operation.operationId }).lean()
  if (prior) {
    if (String(prior.userId) !== String(req.user._id) || prior.deviceId !== req.body.deviceId) {
      return { status: 'error', retryable: false, message: 'This operation ID is already owned by another account or device.', data: null, currentStock: [] }
    }
    return prior.result
  }

  const session = await mongoose.startSession()
  let result
  try {
    await session.withTransaction(async () => {
      const duplicate = await SyncReceipt.findOne({ operationId: operation.operationId }).session(session).lean()
      if (duplicate) {
        result = String(duplicate.userId) === String(req.user._id) && duplicate.deviceId === req.body.deviceId
          ? duplicate.result
          : { status: 'error', retryable: false, message: 'This operation ID is already owned by another account or device.', data: null, currentStock: [] }
        return
      }
      result = operation.kind === 'sale'
        ? await applySale(session, operation, req)
        : await applyImport(session, operation, req)
      if (result.status !== 'success') throw new OperationOutcomeError(result)
      await saveReceipt(session, operation, req, result)
    })
    return result
  } catch (error) {
    if (error instanceof OperationOutcomeError) {
      result = { ...error.result, currentStock: await readCurrentStock(operation) }
      const receiptSession = await mongoose.startSession()
      try {
        await receiptSession.withTransaction(async () => {
          const duplicate = await SyncReceipt.findOne({ operationId: operation.operationId }).session(receiptSession).lean()
          if (duplicate) {
            result = String(duplicate.userId) === String(req.user._id) && duplicate.deviceId === req.body.deviceId
              ? duplicate.result
              : { status: 'error', retryable: false, message: 'This operation ID is already owned by another account or device.', data: null, currentStock: [] }
            return
          }
          await saveReceipt(receiptSession, operation, req, result)
        })
      } finally {
        await receiptSession.endSession()
      }
      return result
    }
    if (error.code === 11000) {
      const duplicate = await SyncReceipt.findOne({ operationId: operation.operationId }).lean()
      if (duplicate && String(duplicate.userId) === String(req.user._id) && duplicate.deviceId === req.body.deviceId) return duplicate.result
    }
    throw error
  } finally {
    await session.endSession()
  }
}

const readCurrentStock = async (operation) => {
  const ids = operation?.kind === 'sale'
    ? (Array.isArray(operation.payload?.items) ? operation.payload.items : []).map((item) => item?.productId)
    : [operation?.payload?.productId]
  if (!ids.some((id) => mongoose.Types.ObjectId.isValid(id))) return []
  return stockSnapshot(ids, null)
}

exports.batch = async (req, res) => {
  const operations = req.body?.operations
  if (!Array.isArray(operations) || operations.length < 1) {
    return res.status(400).json({ success: false, message: 'Provide at least one sync operation.' })
  }
  if (operations.length > MAX_BATCH_SIZE) {
    return res.status(413).json({ success: false, code: 'BATCH_TOO_LARGE', message: `A sync batch may contain at most ${MAX_BATCH_SIZE} operations.` })
  }
  if (typeof req.body.deviceId !== 'string' || req.body.deviceId.length > 100) {
    return res.status(400).json({ success: false, message: 'A valid deviceId is required.' })
  }

  const results = []
  for (const raw of operations) {
    const parsed = operationRule.safeParse(raw)
    if (!parsed.success) {
      results.push({ operationId: raw?.operationId || null, status: 'error', retryable: false, message: parsed.error.issues[0]?.message || 'Invalid sync operation.', currentStock: await readCurrentStock(raw) })
      continue
    }
    try {
      results.push({ operationId: parsed.data.operationId, ...(await processOperation(parsed.data, req)) })
    } catch (error) {
      console.error('Offline sync operation failed:', error.message)
      const infrastructureError = !error.status && error.code !== 11000
      results.push({
        operationId: parsed.data.operationId,
        status: 'error',
        retryable: infrastructureError || error.status >= 500,
        message: infrastructureError ? 'Sync is temporarily unavailable. This operation is safe to retry.' : error.message,
        currentStock: await readCurrentStock(parsed.data).catch(() => []),
      })
      if (infrastructureError) {
        for (const remaining of operations.slice(results.length)) {
          results.push({ operationId: remaining?.operationId || null, status: 'error', retryable: true, message: 'This batch stopped because the sync service is temporarily unavailable.', currentStock: [] })
        }
        break
      }
    }
  }
  res.json({ success: true, data: results, meta: { batchSize: operations.length, maxBatchSize: MAX_BATCH_SIZE } })
}

exports.MAX_BATCH_SIZE = MAX_BATCH_SIZE
