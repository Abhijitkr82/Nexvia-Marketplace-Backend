
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ['customer', 'vendor', 'admin'],
      default: 'customer',
    },

    vendorStatus: {
      type: String,
      enum: ['not_applicable', 'pending', 'approved', 'rejected'],
      default: 'not_applicable',
    },

    phone: {
      type: String,
      default: '',
    },

    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String,
    },

    // Razorpay Route linked account details
    razorpayAccountId: {
      type: String,
      default: '',
      trim: true,
    },

    payoutStatus: {
      type: String,
      enum: ['not_connected', 'pending', 'enabled', 'rejected'],
      default: 'not_connected',
    },
  },
  {
    timestamps: true,
  }
);

// Set vendor approval status automatically for new vendors.
userSchema.pre('validate', function () {
  if (this.role === 'vendor') {
    if (!this.vendorStatus || this.vendorStatus === 'not_applicable') {
      this.vendorStatus = 'pending';
    }
  } else {
    this.vendorStatus = 'not_applicable';
  }
});

const User = mongoose.model('User', userSchema);

module.exports = User;
