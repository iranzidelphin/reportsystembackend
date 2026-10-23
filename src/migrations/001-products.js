require('dotenv').config()
const connectDb = require('../config/db')
const mongoose = require('mongoose')
const Product = require('../models/Product')
const Transaction = require('../models/Transaction')
const Expense = require('../models/Expense')
const { ensureDefaultAdmin } = require('../utils/defaultAdmin')

async function migrate() {
  await connectDb()
  const admin = await ensureDefaultAdmin()
  const db = mongoose.connection.db
  for (const collection of ['products', 'transactions', 'expenses']) {
    try { await db.createCollection(collection) } catch (error) {
      if (error.codeName !== 'NamespaceExists') throw error
    }
  }
  await Product.syncIndexes()
  await Transaction.collection.createIndex({ productId: 1 })
  await Expense.collection.createIndex({ productId: 1 })
  console.log('Product and stock history indexes are ready.')
  await mongoose.disconnect()
}

migrate().catch(async (error) => {
  console.error('Migration failed:', error.message)
  await mongoose.disconnect()
  process.exitCode = 1
})
