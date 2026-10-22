const mongoose = require('mongoose')

async function connectDb() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL

  if (!uri) {
    throw new Error('Set MONGODB_URI or MONGO_URL in backend/.env')
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  })
  console.log('MongoDB connected successfully')
}

module.exports = connectDb
