require('dotenv').config()
const mongoose = require('mongoose')
const connectDb = require('../config/db')

async function migrate() {
  await connectDb()
  const collectionName = 'syncreceipts'
  try {
    await mongoose.connection.db.createCollection(collectionName)
  } catch (error) {
    if (error.codeName !== 'NamespaceExists') throw error
  }
  await mongoose.connection.db.collection(collectionName).createIndex(
    { operationId: 1 },
    { unique: true, name: 'operationId_1' },
  )
  await mongoose.connection.db.collection(collectionName).createIndex(
    { userId: 1, createdAt: -1 },
    { name: 'userId_1_createdAt_-1' },
  )
  console.log('Offline sync receipt indexes are ready.')
  await mongoose.disconnect()
}

migrate().catch(async (error) => {
  console.error('Sync receipt migration failed:', error.message)
  await mongoose.disconnect()
  process.exitCode = 1
})
