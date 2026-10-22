const { Schema, model } = require('mongoose');

const schema = new Schema(
  {
    description: {
      type: String,
      required: true,
      trim: true
    },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
    stockQuantity: { type: Number, min: 0, default: 0 },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    paymentMethod: {
      type: String,
      enum: ['CASH', 'MOMO', 'CARD', 'BANK', 'OTHER'],
      default: 'OTHER'
    },
    expenseDate: {
      type: Date
    },
    date: {
      type: Date,
      required: true,
      default: Date.now
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  {
    timestamps: true
  }
);

schema.pre('validate', function () {
  if (!this.expenseDate && this.date)
    this.expenseDate = this.date;

  if (!this.date && this.expenseDate)
    this.date = this.expenseDate;
});

module.exports = model('Expense', schema);
