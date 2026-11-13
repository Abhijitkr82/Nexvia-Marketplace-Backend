
const mongoose = require('mongoose');

const paymentAttemptSchema = new mongoose.Schema(
    {
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        razorpayOrderId: {
            type: String,
            required: true,
            unique: true,
        },
        products: [
            {
                product: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'Product',
                    required: true,
                },
                quantity: {
                    type: Number,
                    required: true,
                    min: 1,
                },
                unitPrice: {
                    type: Number,
                    required: true,
                    min: 0,
                },
            },
        ],
        shippingAddress: {
            street: { type: String, required: true },
            city: { type: String, required: true },
            state: { type: String, required: true },
            zipCode: { type: String, required: true },
            country: { type: String, required: true },
        },
        amountPaise: {
            type: Number,
            required: true,
            min: 100,
        },
        subtotalPaise: {
            type: Number,
            required: true,
            min: 0,
        },
        discountPaise: {
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
        status: {
            type: String,
            enum: ['created', 'paid', 'failed'],
            default: 'created',
        },

        refundStatus: {
            type: String,
            enum: ['not_required', 'pending', 'processed', 'failed'],
            default: 'not_required',
        },
        razorpayPaymentId: {
            type: String,
            default: null,
        },
        razorpayRefundId: {
            type: String,
            default: null,
        },
        refundError: {
            type: String,
            default: '',
            maxlength: 500,
        },

        order: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Order',
            default: null,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model(
    'PaymentAttempt',
    paymentAttemptSchema
);
