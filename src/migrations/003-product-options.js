require('dotenv').config()
const mongoose = require('mongoose')
const connectDb = require('../config/db')

async function migrate() {
  await connectDb()
  const ProductOption = require('../models/ProductOption')
  await ProductOption.collection.createIndex(
    { type: 1, name: 1 },
    { unique: true, name: 'type_1_name_1', collation: { locale: 'en', strength: 2 } },
  )
  console.log('Product option indexes are ready.')
  await mongoose.disconnect()
}

migrate().catch(async (error) => {
  console.error('Product option migration failed:', error.message)
  await mongoose.disconnect()
  process.exitCode = 1
})
