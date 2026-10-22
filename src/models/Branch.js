const { Schema, model } = require('mongoose')

const schema = new Schema({
  name: { type: String, required: true, trim: true, unique: true },
  code: { type: String, trim: true, uppercase: true, unique: true, sparse: true },
  address: { type: String, trim: true, default: '' },
  phone: { type: String, trim: true, default: '' },
  managerName: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

module.exports = model('Branch', schema)
