const { Schema, model } = require('mongoose')

const schema = new Schema({
  operationId: { type: String, required: true, unique: true, immutable: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  deviceId: { type: String, required: true },
  kind: { type: String, enum: ['sale', 'import'], required: true },
  result: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true })

// Receipts are intentionally retained without a TTL: a delayed client retry
// must never reapply an operation after a receipt has expired.
module.exports = model('SyncReceipt', schema)
