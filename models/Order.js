
const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    products: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Product',
          required: true,
        },
        vendor: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
        fulfillmentStatus: {
          type: String,
          enum: [
            'Pending',
            'Processing',
            'Shipped',
            'Delivered',
            'Cancelled',
          ],
          default: 'Pending',
        },
        unitPrice: {
          type: Number,
          min: 0,
        },
        lineTotal: {
          type: Number,
          min: 0,
        },
        commissionRate: {
          type: Number,
          default: 10,
          min: 0,
          max: 100,
        },
        commissionAmount: {
          type: Number,
          min: 0,
        },
        vendorEarning: {
          type: Number,
          min: 0,
        },
      },
    ],

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    subtotalAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    couponCode: {
      type: String,
      default: '',
      uppercase: true,
      trim: true,
    },
    shippingAddress: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String,
    },

    status: {
      type: String,
      enum: [
        'Pending',
        'Processing',
        'Shipped',
        'Delivered',
        'Cancelled',
      ],
      default: 'Pending',
      index: true,
    },

    paymentMethod: {
      type: String,
      enum: ['Razorpay', 'COD'],
      default: 'Razorpay',
    },

    paymentStatus: {
      type: String,
      enum: [
        'Pending',
        'Paid',
        'Refund Pending',
        'Partially Refunded',
        'Refunded',
        'Failed',
      ],
      default: 'Pending',
      index: true,
    },

    razorpayOrderId: {
      type: String,
      default: null,
    },

    razorpayPaymentId: {
      type: String,
      default: null,
    },

    razorpayRefundId: {
      type: String,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    cancellationReason: {
      type: String,
      default: '',
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  }
);

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;
