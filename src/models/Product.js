const { Schema, model } = require('mongoose')

const schema = new Schema({
  name: { type: String, required: true, trim: true },
  sku: { type: String, trim: true, uppercase: true, unique: true, sparse: true },
  category: { type: String, trim: true, default: '' },
  brand: { type: String, trim: true, default: '' },
  description: { type: String, trim: true, default: '' },
  unit: { type: String, trim: true, default: 'piece' },
  costPrice: { type: Number, min: 0, default: 0 },
  sellingPrice: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 0, default: 0 },
  lowStockLevel: { type: Number, min: 0, default: 5 },
  location: { type: String, required: true, trim: true },
  supplier: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  notes: { type: String, trim: true, default: '' },
  addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  lastUpdatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

schema.index({ name: 'text', sku: 'text', brand: 'text', category: 'text' })
module.exports = model('Product', schema)
