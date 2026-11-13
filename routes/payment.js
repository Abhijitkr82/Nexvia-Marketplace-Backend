
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const mongoose = require('mongoose');

const Payout = require('../models/Payout');
const Coupon = require('../models/Coupon');
const PaymentAttempt = require('../models/PaymentAttempt');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { auth, verifyRole } = require('../middleware/auth');

const router = express.Router();

const COMMISSION_RATE = 10;

function getRazorpay() {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;

    if (!key_id || !key_secret) {
        throw new Error('Razorpay keys are not configured.');
    }

    return {
        client: new Razorpay({ key_id, key_secret }),
        key_id,
        key_secret,
    };
}

async function calculateCouponDiscount(couponCode, subtotalPaise) {
    const code = String(couponCode || '').trim().toUpperCase();

    if (!code) {
        return {
            coupon: null,
            couponCode: '',
            discountPaise: 0,
        };
    }

    const coupon = await Coupon.findOne({ code, isActive: true });

    if (!coupon) {
        throw new Error('Invalid or inactive coupon code.');
    }

    const now = new Date();

    if (coupon.startsAt > now || coupon.expiresAt <= now) {
        throw new Error('This coupon is not currently valid.');
    }

    if (
        coupon.usageLimit !== null &&
        coupon.usedCount >= coupon.usageLimit
    ) {
        throw new Error('Coupon usage limit reached.');
    }

    if (subtotalPaise < Math.round(coupon.minOrderAmount * 100)) {
        throw new Error(
            `Minimum order amount for this coupon is ₹${coupon.minOrderAmount}.`
        );
    }

    let discountPaise;

    if (coupon.discountType === 'percentage') {
        if (coupon.discountValue > 100) {
            throw new Error('Coupon percentage cannot exceed 100%.');
        }

        discountPaise = Math.round(
            subtotalPaise * coupon.discountValue / 100
        );

        if (coupon.maxDiscount !== null) {
            discountPaise = Math.min(
                discountPaise,
                Math.round(coupon.maxDiscount * 100)
            );
        }
    } else {
        discountPaise = Math.round(coupon.discountValue * 100);
    }

    discountPaise = Math.min(discountPaise, subtotalPaise);

    return {
        coupon,
        couponCode: coupon.code,
        discountPaise,
    };
}

function allocateDiscount(orderProducts, discountPaise) {
    const subtotalPaise = orderProducts.reduce(
        (sum, item) =>
            sum + Math.round(item.unitPrice * 100) * item.quantity,
        0
    );

    if (subtotalPaise <= 0 || discountPaise < 0 || discountPaise > subtotalPaise) {
        throw new Error('Invalid discount allocation.');
    }

    let remainingDiscount = discountPaise;

    return orderProducts.map((item, index) => {
        const originalLinePaise =
            Math.round(item.unitPrice * 100) * item.quantity;

        const allocatedDiscount =
            index === orderProducts.length - 1
                ? remainingDiscount
                : Math.round(
                    discountPaise * originalLinePaise / subtotalPaise
                );

        remainingDiscount -= allocatedDiscount;

        const lineTotalPaise = originalLinePaise - allocatedDiscount;
        const commissionPaise = Math.round(
            lineTotalPaise * COMMISSION_RATE / 100
        );
        const vendorEarningPaise = lineTotalPaise - commissionPaise;

        return {
            ...item,
            lineTotal: lineTotalPaise / 100,
            commissionRate: COMMISSION_RATE,
            commissionAmount: commissionPaise / 100,
            vendorEarning: vendorEarningPaise / 100,
            fulfillmentStatus: 'Pending',
        };
    });
}

function buildVendorPayouts(orderProducts, orderId, status) {
    const vendorPayouts = new Map();

    for (const item of orderProducts) {
        const vendorId = item.vendor.toString();

        if (!vendorPayouts.has(vendorId)) {
            vendorPayouts.set(vendorId, {
                vendor: item.vendor,
                grossAmount: 0,
                commissionAmount: 0,
                vendorEarning: 0,
            });
        }

        const payout = vendorPayouts.get(vendorId);

        payout.grossAmount += item.lineTotal;
        payout.commissionAmount += item.commissionAmount;
        payout.vendorEarning += item.vendorEarning;
    }

    return [...vendorPayouts.values()].map((payout) => ({
        ...payout,
        order: orderId,
        status,
    }));
}

async function incrementCouponUsage(couponCode, session) {
    if (!couponCode) return;

    const now = new Date();

    const updatedCoupon = await Coupon.findOneAndUpdate(
        {
            code: couponCode,
            isActive: true,
            startsAt: { $lte: now },
            expiresAt: { $gt: now },
            $expr: {
                $or: [
                    { $eq: ['$usageLimit', null] },
                    { $lt: ['$usedCount', '$usageLimit'] },
                ],
            },
        },
        { $inc: { usedCount: 1 } },
        { new: true, session }
    );

    if (!updatedCoupon) {
        throw new Error(
            'Coupon is no longer valid or its usage limit has been reached.'
        );
    }
}
// VALIDATE COUPON
router.post(
    '/validate-coupon',
    auth,
    verifyRole('customer'),
    async (req, res) => {
        try {
            const { products, couponCode } = req.body;

            if (!Array.isArray(products) || products.length === 0) {
                return res.status(400).json({
                    message: 'Your cart is empty.',
                });
            }

            if (
                typeof couponCode !== 'string' ||
                !couponCode.trim()
            ) {
                return res.status(400).json({
                    message: 'Please enter a coupon code.',
                });
            }

            const quantities = new Map();

            for (const item of products) {
                if (
                    !item.product ||
                    !mongoose.isValidObjectId(item.product) ||
                    !Number.isSafeInteger(Number(item.quantity)) ||
                    Number(item.quantity) < 1
                ) {
                    return res.status(400).json({
                        message: 'Invalid product or quantity.',
                    });
                }

                const id = String(item.product);
                quantities.set(
                    id,
                    (quantities.get(id) || 0) + Number(item.quantity)
                );
            }

            const ids = [...quantities.keys()];

            const databaseProducts = await Product.find({
                _id: { $in: ids },
            });

            if (databaseProducts.length !== ids.length) {
                return res.status(400).json({
                    message: 'One or more products are unavailable.',
                });
            }

            let subtotalPaise = 0;

            for (const product of databaseProducts) {
                const quantity = quantities.get(product._id.toString());

                if (
                    !Number.isFinite(product.price) ||
                    product.price <= 0 ||
                    !Number.isInteger(product.stock) ||
                    product.stock < quantity
                ) {
                    return res.status(400).json({
                        message: `Insufficient stock or invalid price for "${product.title}".`,
                    });
                }

                subtotalPaise += Math.round(product.price * 100) * quantity;
            }

            const couponResult = await calculateCouponDiscount(
                couponCode,
                subtotalPaise
            );

            const discountPaise = couponResult.discountPaise;
            const totalPaise = subtotalPaise - discountPaise;

            return res.status(200).json({
                message: 'Coupon applied successfully.',
                couponCode: couponResult.couponCode,
                subtotal: subtotalPaise / 100,
                discount: discountPaise / 100,
                totalAmount: totalPaise / 100,
            });
        } catch (error) {
            return res.status(400).json({
                message: error.message || 'Unable to validate coupon.',
            });
        }
    }
);
// CREATE RAZORPAY ORDER
router.post(
    '/create-order',
    auth,
    verifyRole('customer'),
    async (req, res) => {
        try {
            const { products, shippingAddress, couponCode } = req.body;

            if (!Array.isArray(products) || products.length === 0) {
                return res.status(400).json({ message: 'Your cart is empty.' });
            }

            if (
                !shippingAddress ||
                typeof shippingAddress !== 'object' ||
                Array.isArray(shippingAddress)
            ) {
                return res.status(400).json({
                    message: 'Shipping address is required.',
                });
            }

            const requiredFields = [
                'street',
                'city',
                'state',
                'zipCode',
                'country',
            ];

            for (const field of requiredFields) {
                if (
                    typeof shippingAddress[field] !== 'string' ||
                    !shippingAddress[field].trim()
                ) {
                    return res.status(400).json({
                        message: `Shipping address ${field} is required.`,
                    });
                }
            }

            if (!/^\d{6}$/.test(shippingAddress.zipCode.trim())) {
                return res.status(400).json({
                    message: 'Please provide a valid 6-digit PIN code.',
                });
            }

            const quantities = new Map();

            for (const item of products) {
                if (
                    !item.product ||
                    !mongoose.isValidObjectId(item.product) ||
                    !Number.isSafeInteger(Number(item.quantity)) ||
                    Number(item.quantity) < 1
                ) {
                    return res.status(400).json({
                        message: 'Invalid product or quantity.',
                    });
                }

                const id = String(item.product);
                const quantity =
                    (quantities.get(id) || 0) + Number(item.quantity);

                if (!Number.isSafeInteger(quantity)) {
                    return res.status(400).json({
                        message: 'Invalid product quantity.',
                    });
                }

                quantities.set(id, quantity);
            }

            const ids = [...quantities.keys()];

            const databaseProducts = await Product.find({
                _id: { $in: ids },
            });

            if (databaseProducts.length !== ids.length) {
                return res.status(400).json({
                    message: 'One or more products are unavailable.',
                });
            }

            let subtotalPaise = 0;

            const orderProducts = databaseProducts.map((product) => {
                const quantity = quantities.get(product._id.toString());

                if (
                    !Number.isFinite(product.price) ||
                    product.price <= 0 ||
                    !Number.isInteger(product.stock) ||
                    product.stock < quantity
                ) {
                    throw new Error(
                        `Insufficient stock or invalid price for "${product.title}".`
                    );
                }

                const unitPaise = Math.round(product.price * 100);

                if (!Number.isSafeInteger(unitPaise) || unitPaise <= 0) {
                    throw new Error('A product has an invalid price.');
                }

                subtotalPaise += unitPaise * quantity;

                return {
                    product: product._id,
                    quantity,
                    unitPrice: unitPaise / 100,
                };
            });

            if (
                !Number.isSafeInteger(subtotalPaise) ||
                subtotalPaise < 100 ||
                subtotalPaise > 100000000
            ) {
                return res.status(400).json({
                    message: 'Order amount is outside the supported limits.',
                });
            }

            const couponResult = await calculateCouponDiscount(
                couponCode,
                subtotalPaise
            );

            const discountPaise = couponResult.discountPaise;
            const totalPaise = subtotalPaise - discountPaise;

            if (totalPaise < 100) {
                return res.status(400).json({
                    message: 'Final order amount must be at least ₹1.',
                });
            }

            const { client, key_id } = getRazorpay();

            const razorpayOrder = await client.orders.create({
                amount: totalPaise,
                currency: 'INR',
                receipt: `nv_${new mongoose.Types.ObjectId().toString()}`,
            });

            const attempt = await PaymentAttempt.create({
                customer: req.user.id,
                razorpayOrderId: razorpayOrder.id,
                products: orderProducts,
                shippingAddress: {
                    street: shippingAddress.street.trim(),
                    city: shippingAddress.city.trim(),
                    state: shippingAddress.state.trim(),
                    zipCode: shippingAddress.zipCode.trim(),
                    country: shippingAddress.country.trim(),
                },
                subtotalPaise,
                discountPaise,
                couponCode: couponResult.couponCode,
                amountPaise: totalPaise,
                status: 'created',
            });

            return res.status(201).json({
                keyId: key_id,
                razorpayOrderId: razorpayOrder.id,
                amount: totalPaise,
                currency: 'INR',
                subtotal: subtotalPaise / 100,
                discount: discountPaise / 100,
                totalAmount: totalPaise / 100,
                couponCode: couponResult.couponCode,
                paymentAttemptId: attempt._id,
            });
        } catch (error) {
            console.error('Create payment order error:', error);

            return res.status(400).json({
                message: error.message || 'Unable to create payment order.',
            });
        }
    }
);

// CREATE COD ORDER
router.post(
    '/cod-order',
    auth,
    verifyRole('customer'),
    async (req, res) => {
        let session;

        try {
            const { products, shippingAddress, couponCode } = req.body;

            if (!Array.isArray(products) || products.length === 0) {
                return res.status(400).json({ message: 'Your cart is empty.' });
            }

            if (
                !shippingAddress ||
                typeof shippingAddress !== 'object' ||
                Array.isArray(shippingAddress)
            ) {
                return res.status(400).json({
                    message: 'Shipping address is required.',
                });
            }

            const requiredFields = [
                'street',
                'city',
                'state',
                'zipCode',
                'country',
            ];

            for (const field of requiredFields) {
                if (
                    typeof shippingAddress[field] !== 'string' ||
                    !shippingAddress[field].trim()
                ) {
                    return res.status(400).json({
                        message: `Shipping address ${field} is required.`,
                    });
                }
            }

            if (!/^\d{6}$/.test(shippingAddress.zipCode.trim())) {
                return res.status(400).json({
                    message: 'Please provide a valid 6-digit PIN code.',
                });
            }

            const quantities = new Map();

            for (const item of products) {
                if (
                    !item.product ||
                    !mongoose.isValidObjectId(item.product) ||
                    !Number.isSafeInteger(Number(item.quantity)) ||
                    Number(item.quantity) < 1
                ) {
                    return res.status(400).json({
                        message: 'Invalid product or quantity.',
                    });
                }

                const id = String(item.product);
                const quantity =
                    (quantities.get(id) || 0) + Number(item.quantity);

                if (!Number.isSafeInteger(quantity)) {
                    return res.status(400).json({
                        message: 'Invalid product quantity.',
                    });
                }

                quantities.set(id, quantity);
            }

            const ids = [...quantities.keys()];

            session = await mongoose.startSession();

            let createdOrder;

            await session.withTransaction(async () => {
                const databaseProducts = await Product.find({
                    _id: { $in: ids },
                }).session(session);

                if (databaseProducts.length !== ids.length) {
                    throw new Error('One or more products are unavailable.');
                }

                let subtotalPaise = 0;

                const orderProductsWithVendor = databaseProducts.map((product) => {
                    const quantity = quantities.get(product._id.toString());

                    if (
                        !product.vendor ||
                        !Number.isFinite(product.price) ||
                        product.price <= 0 ||
                        !Number.isInteger(product.stock) ||
                        product.stock < quantity
                    ) {
                        throw new Error(
                            `Insufficient stock or invalid product: ${product.title}`
                        );
                    }

                    const unitPaise = Math.round(product.price * 100);

                    if (!Number.isSafeInteger(unitPaise) || unitPaise <= 0) {
                        throw new Error('A product has an invalid price.');
                    }

                    subtotalPaise += unitPaise * quantity;

                    return {
                        product: product._id,
                        vendor: product.vendor,
                        quantity,
                        unitPrice: unitPaise / 100,
                    };
                });

                if (
                    !Number.isSafeInteger(subtotalPaise) ||
                    subtotalPaise < 100
                ) {
                    throw new Error('Invalid order amount.');
                }

                const couponResult = await calculateCouponDiscount(
                    couponCode,
                    subtotalPaise
                );

                const discountPaise = couponResult.discountPaise;
                const finalTotalPaise = subtotalPaise - discountPaise;

                if (finalTotalPaise < 100) {
                    throw new Error('Final order amount must be at least ₹1.');
                }

                const discountedProducts = allocateDiscount(
                    orderProductsWithVendor,
                    discountPaise
                );

                await incrementCouponUsage(
                    couponResult.couponCode,
                    session
                );

                for (const item of orderProductsWithVendor) {
                    const updated = await Product.updateOne(
                        {
                            _id: item.product,
                            stock: { $gte: item.quantity },
                        },
                        {
                            $inc: { stock: -item.quantity },
                        },
                        { session }
                    );

                    if (updated.modifiedCount !== 1) {
                        throw new Error('Stock changed. Please try again.');
                    }
                }

                const [order] = await Order.create(
                    [
                        {
                            customer: req.user.id,
                            products: discountedProducts,
                            subtotalAmount: subtotalPaise / 100,
                            discountAmount: discountPaise / 100,
                            couponCode: couponResult.couponCode,
                            totalAmount: finalTotalPaise / 100,
                            shippingAddress: {
                                street: shippingAddress.street.trim(),
                                city: shippingAddress.city.trim(),
                                state: shippingAddress.state.trim(),
                                zipCode: shippingAddress.zipCode.trim(),
                                country: shippingAddress.country.trim(),
                            },
                            status: 'Pending',
                            paymentMethod: 'COD',
                            paymentStatus: 'Pending',
                        },
                    ],
                    { session }
                );

                const payoutRecords = buildVendorPayouts(
                    order.products,
                    order._id,
                    'pending'
                );

                await Payout.create(payoutRecords, { session });

                createdOrder = order;
            });

            return res.status(201).json({
                message: 'Cash on Delivery order placed successfully.',
                orderId: createdOrder._id,
                paymentMethod: 'COD',
                paymentStatus: 'Pending',
                subtotal: createdOrder.subtotalAmount,
                discount: createdOrder.discountAmount,
                couponCode: createdOrder.couponCode,
                totalAmount: createdOrder.totalAmount,
            });
        } catch (error) {
            console.error('COD order error:', error);

            return res.status(400).json({
                message: error.message || 'Unable to place COD order.',
            });
        } finally {
            if (session) {
                await session.endSession();
            }
        }
    }
);

// VERIFY RAZORPAY PAYMENT AND CREATE ORDER
router.post(
    '/verify',
    auth,
    verifyRole('customer'),
    async (req, res) => {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
        } = req.body;

        if (
            typeof razorpay_order_id !== 'string' ||
            typeof razorpay_payment_id !== 'string' ||
            typeof razorpay_signature !== 'string'
        ) {
            return res.status(400).json({
                message: 'Payment verification details are required.',
            });
        }

        let session;

        try {
            const attempt = await PaymentAttempt.findOne({
                razorpayOrderId: razorpay_order_id,
                customer: req.user.id,
            });

            if (!attempt) {
                return res.status(404).json({
                    message: 'Payment attempt not found.',
                });
            }

            if (attempt.status === 'paid' && attempt.order) {
                return res.status(200).json({
                    message: 'Payment was already verified.',
                    orderId: attempt.order,
                });
            }

            if (attempt.status !== 'created') {
                return res.status(409).json({
                    message: 'This payment attempt cannot be verified.',
                });
            }

            const { client, key_secret } = getRazorpay();

            const expectedSignature = crypto
                .createHmac('sha256', key_secret)
                .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                .digest('hex');

            const supplied = Buffer.from(razorpay_signature, 'hex');
            const expected = Buffer.from(expectedSignature, 'hex');

            if (
                supplied.length !== expected.length ||
                !crypto.timingSafeEqual(supplied, expected)
            ) {
                return res.status(400).json({
                    message: 'Invalid payment signature.',
                });
            }

            const payment = await client.payments.fetch(razorpay_payment_id);

            if (
                payment.order_id !== razorpay_order_id ||
                payment.status !== 'captured' ||
                payment.amount !== attempt.amountPaise ||
                payment.currency !== 'INR'
            ) {
                return res.status(400).json({
                    message: 'Payment is not captured or does not match the order.',
                });
            }

            session = await mongoose.startSession();

            let createdOrderId;

            await session.withTransaction(async () => {
                const currentAttempt = await PaymentAttempt.findOne({
                    _id: attempt._id,
                    customer: req.user.id,
                    status: 'created',
                }).session(session);

                if (!currentAttempt) {
                    throw new Error('PAYMENT_ATTEMPT_ALREADY_PROCESSED');
                }

                const subtotalPaise = currentAttempt.subtotalPaise;
                const discountPaise = currentAttempt.discountPaise || 0;

                if (
                    !Number.isSafeInteger(subtotalPaise) ||
                    !Number.isSafeInteger(discountPaise) ||
                    discountPaise < 0 ||
                    discountPaise > subtotalPaise ||
                    subtotalPaise - discountPaise !== currentAttempt.amountPaise
                ) {
                    throw new Error('Payment amount or coupon details are invalid.');
                }

                const ids = currentAttempt.products.map(
                    (item) => item.product
                );

                const databaseProducts = await Product.find({
                    _id: { $in: ids },
                }).session(session);

                if (databaseProducts.length !== ids.length) {
                    throw new Error(
                        'A product is no longer available. Refund handling is required.'
                    );
                }

                const orderProductsWithVendor = currentAttempt.products.map((item) => {
                    const product = databaseProducts.find(
                        (entry) =>
                            entry._id.toString() === item.product.toString()
                    );

                    if (!product || !product.vendor) {
                        throw new Error('Product vendor information is missing.');
                    }

                    const unitPrice = Number(item.unitPrice);

                    if (
                        !Number.isFinite(unitPrice) ||
                        unitPrice <= 0 ||
                        !Number.isSafeInteger(item.quantity) ||
                        item.quantity < 1
                    ) {
                        throw new Error('Invalid checkout product details.');
                    }

                    return {
                        product: product._id,
                        vendor: product.vendor,
                        quantity: item.quantity,
                        unitPrice,
                    };
                });

                const discountedProducts = allocateDiscount(
                    orderProductsWithVendor,
                    discountPaise
                );

                await incrementCouponUsage(
                    currentAttempt.couponCode,
                    session
                );

                for (const item of currentAttempt.products) {
                    const product = databaseProducts.find(
                        (entry) =>
                            entry._id.toString() === item.product.toString()
                    );

                    if (!product || product.stock < item.quantity) {
                        throw new Error(
                            'Insufficient stock after payment. Refund handling is required.'
                        );
                    }

                    const updated = await Product.updateOne(
                        {
                            _id: product._id,
                            stock: { $gte: item.quantity },
                        },
                        {
                            $inc: { stock: -item.quantity },
                        },
                        { session }
                    );

                    if (updated.modifiedCount !== 1) {
                        throw new Error(
                            'Stock changed after payment. Refund handling is required.'
                        );
                    }
                }

                const [order] = await Order.create(
                    [
                        {
                            customer: currentAttempt.customer,
                            products: discountedProducts,
                            subtotalAmount: subtotalPaise / 100,
                            discountAmount: discountPaise / 100,
                            couponCode: currentAttempt.couponCode || '',
                            totalAmount: currentAttempt.amountPaise / 100,
                            shippingAddress: currentAttempt.shippingAddress,
                            status: 'Pending',
                            paymentMethod: 'Razorpay',
                            paymentStatus: 'Paid',
                            razorpayOrderId: currentAttempt.razorpayOrderId,
                            razorpayPaymentId: razorpay_payment_id,
                        },
                    ],
                    { session }
                );

                currentAttempt.status = 'paid';
                currentAttempt.razorpayPaymentId = razorpay_payment_id;
                currentAttempt.order = order._id;

                await currentAttempt.save({ session });

                const payoutRecords = buildVendorPayouts(
                    order.products,
                    order._id,
                    'eligible'
                );

                await Payout.create(payoutRecords, { session });

                createdOrderId = order._id;
            });

            return res.status(200).json({
                message: 'Payment verified and order created.',
                orderId: createdOrderId,
            });
        } catch (error) {
            console.error('Verify payment error:', error.message);

            if (error.message === 'PAYMENT_ATTEMPT_ALREADY_PROCESSED') {
                return res.status(409).json({
                    message: 'This payment attempt has already been processed.',
                });
            }

            return res.status(500).json({
                message: error.message || 'Unable to verify payment.',
            });
        } finally {
            if (session) {
                await session.endSession();
            }
        }
    }
);

module.exports = router;
