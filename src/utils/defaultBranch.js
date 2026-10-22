const Branch = require('../models/Branch')
const Product = require('../models/Product')
const Transaction = require('../models/Transaction')
const Expense = require('../models/Expense')

async function ensureDefaultBranch(admin) {
  let branch = await Branch.findOne({ name: 'Kigali Main Store' })
  if (!branch) branch = await Branch.create({ name: 'Kigali Main Store', code: 'KGL-MAIN', createdBy: admin._id })
  await Promise.all([
    Product.updateMany({ branchId: { $exists: false } }, { $set: { branchId: branch._id } }),
    Transaction.updateMany({ branchId: { $exists: false } }, { $set: { branchId: branch._id } }),
    Expense.updateMany({ branchId: { $exists: false } }, { $set: { branchId: branch._id } }),
  ])
  return branch
}

module.exports = { ensureDefaultBranch }
