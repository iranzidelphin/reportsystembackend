const { Schema, model } = require('mongoose')

const schema = new Schema({
  type: { type: String, enum: ['category', 'brand', 'model'], required: true },
  name: { type: String, required: true, trim: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

schema.index({ type: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })
module.exports = model('ProductOption', schema)
