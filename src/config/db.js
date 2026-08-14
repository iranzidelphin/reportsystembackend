const dns = require('dns')
const mongoose = require('mongoose')

async function connectDb() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL

  if (!uri) {
    throw new Error('Set MONGODB_URI or MONGO_URL in backend/.env')
  }

  if (uri.startsWith('mongodb+srv://')) {
    dns.setServers(['8.8.8.8', '1.1.1.1'])
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
  })
  console.log('MongoDB connected successfully')
}

module.exports = connectDb
