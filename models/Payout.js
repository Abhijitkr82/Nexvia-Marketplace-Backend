
const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },

    grossAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    commissionAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    vendorEarning: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
    },

    status: {
      type: String,
      enum: ['pending', 'eligible', 'processing', 'paid', 'failed'],
      default: 'pending',
    },

    transferId: {
      type: String,
      default: '',
      trim: true,
    },

    paidAt: {
      type: Date,
      default: null,
    },

    failureReason: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// One payout record per vendor for each order.
payoutSchema.index(
  { vendor: 1, order: 1 },
  { unique: true }
);

const Payout = mongoose.model('Payout', payoutSchema);

module.exports = Payout;
