
const express = require('express');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const PaymentAttempt = require('../models/PaymentAttempt');
const { auth, verifyRole } = require('../middleware/auth');
const Payout = require('../models/Payout');
const PDFDocument = require('pdfkit');

const router = express.Router();

const requireApprovedVendorOrAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      message: 'Authentication required.',
    });
  }

  // Admins can continue without vendor approval.
  if (req.user.role === 'admin') {
    return next();
  }

  if (req.user.role !== 'vendor') {
    return res.status(403).json({
      message: 'Vendor or admin access required.',
    });
  }

  let vendor;

  try {
    vendor = await User.findById(req.user.id)
      .select('role vendorStatus');
  } catch (error) {
    console.error('Vendor approval database error:', error);

    return res.status(500).json({
      message: 'Unable to verify vendor approval.',
    });
  }

  if (!vendor || vendor.role !== 'vendor') {
    return res.status(403).json({
      message: 'Vendor account not found.',
    });
  }

  if (vendor.vendorStatus !== 'approved') {
    return res.status(403).json({
      message: 'Admin approval is required to access vendor orders.',
    });
  }

  return next();
};
/**
 * Request a full Razorpay refund.
 *
 * Important:
 * - A pending refund is never automatically submitted again.
 * - If the API result is uncertain, manual reconciliation is required.
 * - This prevents a blind retry from creating a duplicate refund.
 */
async function requestRazorpayRefund(orderId) {
  const paymentAttempt = await PaymentAttempt.findOne({
    order: orderId,
  });

  if (!paymentAttempt) {
    return {
      status: 'pending',
      message: 'Payment record not found. Refund reconciliation is required.',
    };
  }

  if (paymentAttempt.refundStatus === 'processed') {
    return {
      status: 'processed',
      refundId: paymentAttempt.razorpayRefundId,
    };
  }

  if (paymentAttempt.refundStatus === 'pending') {
    return {
      status: 'pending',
      message: 'Refund is pending reconciliation.',
    };
  }

  if (!paymentAttempt.razorpayPaymentId) {
    paymentAttempt.refundStatus = 'failed';
    paymentAttempt.refundError = 'Razorpay payment ID is missing.';
    await paymentAttempt.save();

    return {
      status: 'failed',
      message: 'Payment ID is missing.',
    };
  }

  // Atomically claim the refund attempt. Only one request can claim it.
  const claimedAttempt = await PaymentAttempt.findOneAndUpdate(
    {
      _id: paymentAttempt._id,
      refundStatus: { $nin: ['pending', 'processed'] },
    },
    {
      $set: {
        refundStatus: 'pending',
        refundError: '',
      },
    },
    { new: true }
  );

  if (!claimedAttempt) {
    const latestAttempt = await PaymentAttempt.findById(paymentAttempt._id);

    return {
      status: latestAttempt?.refundStatus || 'pending',
      refundId: latestAttempt?.razorpayRefundId || null,
      message: 'Another request has already claimed this refund.',
    };
  }

  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    claimedAttempt.refundError = 'Razorpay keys are not configured.';
    // Keep pending: do not blindly retry a refund with uncertain state.
    await claimedAttempt.save();

    return {
      status: 'pending',
      message: 'Razorpay credentials need to be checked.',
    };
  }

  try {
    const razorpay = new Razorpay({ key_id, key_secret });

    const refund = await razorpay.payments.refund(
      claimedAttempt.razorpayPaymentId,
      {
        amount: claimedAttempt.amountPaise,
        notes: {
          orderId: String(orderId),
          reason: 'Customer cancelled order',
        },
      }
    );

    claimedAttempt.razorpayRefundId = refund.id;
    claimedAttempt.refundStatus =
      refund.status === 'processed' ? 'processed' : 'pending';
    claimedAttempt.refundError = '';
    await claimedAttempt.save();

    if (claimedAttempt.refundStatus === 'processed') {
      await Order.updateOne(
        { _id: orderId, paymentStatus: 'Refund Pending' },
        {
          $set: {
            paymentStatus: 'Refunded',
            razorpayRefundId: refund.id,
          },
        }
      );
    }

    return {
      status: claimedAttempt.refundStatus,
      refundId: refund.id,
    };
  } catch (error) {
    console.error('Razorpay refund result needs reconciliation:', error.message);

    // A timeout does not prove the refund failed. Keep it pending to
    // prevent a duplicate request. Reconcile with Razorpay before retrying.
    claimedAttempt.refundStatus = 'pending';
    claimedAttempt.refundError = String(
      error.message || 'Refund result is uncertain'
    ).slice(0, 500);

    await claimedAttempt.save();

    return {
      status: 'pending',
      message: 'Refund result is uncertain and must be reconciled.',
    };
  }
}

// Direct order creation is disabled. Orders must use verified checkout.
router.post('/create', auth, verifyRole('customer'), async (req, res) => {
  return res.status(410).json({
    message:
      'Direct order creation is disabled. Please complete checkout using Razorpay payment.',
  });
});

// Cancel a customer's order and restore stock transactionally.
router.put(
  '/:id/cancel',
  auth,
  verifyRole('customer'),
  async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order ID.' });
    }

    let session;

    try {
      session = await mongoose.startSession();

      let cancelledOrder;

      await session.withTransaction(async () => {
        const order = await Order.findOne({
          _id: req.params.id,
          customer: req.user.id,
        }).session(session);

        if (!order) {
          throw new Error('ORDER_NOT_FOUND');
        }

        if (order.status === 'Cancelled') {
          throw new Error('ORDER_ALREADY_CANCELLED');
        }

        if (['Shipped', 'Delivered'].includes(order.status)) {
          throw new Error('ORDER_CANNOT_BE_CANCELLED');
        }

        // A paid Razorpay order must have a payment record before
        // cancellation proceeds. This avoids cancelling paid orders
        // without a record from which a refund can be reconciled.
        if (order.paymentStatus === 'Paid') {
          const attempt = await PaymentAttempt.findOne({
            order: order._id,
            customer: req.user.id,
          }).session(session);

          if (!attempt || !attempt.razorpayPaymentId) {
            throw new Error('PAID_PAYMENT_RECORD_MISSING');
          }
        }

        for (const item of order.products) {
          const restored = await Product.updateOne(
            { _id: item.product },
            { $inc: { stock: item.quantity } },
            { session }
          );

          if (restored.modifiedCount !== 1) {
            throw new Error('PRODUCT_STOCK_RESTORE_FAILED');
          }
        }

        order.status = 'Cancelled';
        order.products.forEach((item) => {
          item.fulfillmentStatus = 'Cancelled';
        });
        order.cancelledAt = new Date();
        order.cancellationReason =
          typeof req.body?.reason === 'string'
            ? req.body.reason.trim().slice(0, 500)
            : '';

        if (order.paymentStatus === 'Paid') {
          order.paymentStatus = 'Refund Pending';
        }

        await order.save({ session });
        cancelledOrder = order;
      });

      // The transaction has committed. Call Razorpay outside the
      // transaction because an external API call cannot be rolled back.
      let refundResult = null;

      if (cancelledOrder.paymentStatus === 'Refund Pending') {
        try {
          refundResult = await requestRazorpayRefund(cancelledOrder._id);
        } catch (error) {
          // Cancellation has already committed. Do not report that
          // the order cancellation itself failed because refund handling did.
          console.error('Refund processing error:', error.message);
          refundResult = {
            status: 'pending',
            message: 'Refund requires reconciliation.',
          };
        }
      }

      const latestOrder = await Order.findById(cancelledOrder._id);

      return res.status(200).json({
        message:
          refundResult?.status === 'processed'
            ? 'Order cancelled and refund processed.'
            : refundResult
              ? 'Order cancelled. Refund is pending confirmation.'
              : 'Order cancelled successfully.',
        order: latestOrder || cancelledOrder,
        refund: refundResult,
      });
    } catch (error) {
      if (error.message === 'ORDER_NOT_FOUND') {
        return res.status(404).json({ message: 'Order not found.' });
      }

      if (error.message === 'ORDER_ALREADY_CANCELLED') {
        return res.status(409).json({
          message: 'This order is already cancelled.',
        });
      }

      if (error.message === 'ORDER_CANNOT_BE_CANCELLED') {
        return res.status(400).json({
          message: 'Shipped or delivered orders cannot be cancelled.',
        });
      }

      if (error.message === 'PAID_PAYMENT_RECORD_MISSING') {
        return res.status(409).json({
          message:
            'Payment record is missing. Contact support before cancelling this paid order.',
        });
      }

      console.error('Cancel order error:', error);

      return res.status(500).json({
        message: 'Unable to cancel order.',
      });
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  }
);

// Customer's own orders.
router.get('/my-orders', auth, verifyRole('customer'), async (req, res) => {
  try {
    const orders = await Order.find({ customer: req.user.id })
      .populate('products.product')
      .sort({ createdAt: -1 });

    return res.status(200).json(orders);
  } catch (error) {
    console.error('Fetch customer orders error:', error);

    return res.status(500).json({
      message: 'Unable to fetch orders.',
    });
  }
});

// Vendor's orders: return only products belonging to that vendor.

router.get(
  '/vendor-orders',
  auth,
  verifyRole('vendor', 'admin'),
  requireApprovedVendorOrAdmin,
  async (req, res) => {
    try {
      let vendorProductIds = [];

      // Admin can see products from every vendor.
      if (req.user.role === 'admin') {
        const allProducts = await Product.find({}, { _id: 1 });
        vendorProductIds = allProducts.map((product) => product._id);
      } else {
        // Vendor can see only their own products.
        const vendorProducts = await Product.find(
          { vendor: req.user.id },
          { _id: 1 }
        );

        vendorProductIds = vendorProducts.map((product) => product._id);
      }

      if (vendorProductIds.length === 0) {
        return res.status(200).json([]);
      }

      const orders = await Order.find({
        'products.product': { $in: vendorProductIds },
      })
        .populate('customer', 'name email')
        .populate('products.product', 'title price images vendor')
        .populate('products.vendor', 'name email')
        .sort({ createdAt: -1 });

      const result = orders
        .map((order) => {
          const orderObject = order.toObject();

          if (req.user.role === 'vendor') {
            orderObject.products = orderObject.products.filter((item) => {
              const productVendor =
                item.product?.vendor?._id ||
                item.product?.vendor ||
                item.vendor?._id ||
                item.vendor;

              return (
                productVendor?.toString() === req.user.id.toString()
              );
            });

            // Do not return orders with no products belonging to this vendor.
            if (orderObject.products.length === 0) {
              return null;
            }
          }

          orderObject.vendorTotal = orderObject.products.reduce(
            (total, item) => {
              const quantity = Number(item.quantity) || 0;
              const lineTotal =
                item.lineTotal ??
                (item.unitPrice ?? item.product?.price ?? 0) * quantity;

              return total + (Number(lineTotal) || 0);
            },
            0
          );

          return orderObject;
        })
        .filter(Boolean);

      return res.status(200).json(result);
    } catch (error) {
      console.error('Fetch vendor orders error:', error);

      return res.status(500).json({
        message: 'Unable to fetch orders.',
      });
    }
  }
);


// Update fulfillment status for one vendor-owned order item.
router.put(
  '/:id/status',
  auth,
  verifyRole('vendor', 'admin'),
  requireApprovedVendorOrAdmin,
  async (req, res) => {
    try {
      const { status, productId } = req.body || {};
      const validStatuses = ['Pending', 'Processing', 'Shipped', 'Delivered'];

      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid status value.' });
      }

      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ message: 'Invalid order ID.' });
      }

      if (productId && !mongoose.isValidObjectId(productId)) {
        return res.status(400).json({ message: 'Invalid product ID.' });
      }

      const order = await Order.findById(req.params.id);

      if (!order) {
        return res.status(404).json({ message: 'Order not found.' });
      }

      if (order.status === 'Cancelled') {
        return res.status(409).json({
          message: 'Cancelled orders cannot be updated.',
        });
      }

      let productsToUpdate = [];

      if (req.user.role === 'admin') {
        productsToUpdate = productId
          ? order.products.filter(
              (item) => item.product.toString() === productId.toString()
            )
          : order.products;
      } else {
        const vendorProducts = await Product.find({
          vendor: req.user.id,
          _id: { $in: order.products.map((item) => item.product) },
        }).select('_id');

        const vendorProductIds = new Set(
          vendorProducts.map((product) => product._id.toString())
        );

        if (productId && !vendorProductIds.has(productId.toString())) {
          return res.status(403).json({
            message: 'You can only update fulfillment for your own products.',
          });
        }

        productsToUpdate = order.products.filter((item) => {
          const belongsToVendor = vendorProductIds.has(
            item.product.toString()
          );

          return (
            belongsToVendor &&
            (!productId || item.product.toString() === productId.toString())
          );
        });
      }

      if (productsToUpdate.length === 0) {
        return res.status(404).json({
          message: 'No matching product was found in this order.',
        });
      }

      // Enforce forward-only transitions for vendors at the API boundary.
      if (req.user.role === 'vendor') {
        const allowedTransitions = {
          Pending: 'Processing',
          Processing: 'Shipped',
          Shipped: 'Delivered',
          Delivered: null,
          Cancelled: null,
        };

        const invalidTransition = productsToUpdate.find((item) => {
          const current = item.fulfillmentStatus || 'Pending';
          return allowedTransitions[current] !== status;
        });

        if (invalidTransition) {
          return res.status(409).json({
            message:
              'One or more selected products cannot move to that fulfillment status. Refresh the order and try again.',
          });
        }
      }

      for (const item of productsToUpdate) {
        item.fulfillmentStatus = status;
      }

      const productStatuses = order.products.map(
        (item) => item.fulfillmentStatus || 'Pending'
      );

      if (productStatuses.every((value) => value === 'Cancelled')) {
        order.status = 'Cancelled';
      } else if (productStatuses.every((value) => value === 'Delivered')) {
        order.status = 'Delivered';
      } else if (productStatuses.some((value) => value === 'Shipped')) {
        order.status = 'Shipped';
      } else if (productStatuses.some((value) => value === 'Processing')) {
        order.status = 'Processing';
      } else {
        order.status = 'Pending';
      }

      await order.save();

      // COD is collected only after every item in the order is delivered.
      if (
        order.paymentMethod === 'COD' &&
        order.status === 'Delivered' &&
        order.paymentStatus !== 'Paid'
      ) {
        order.paymentStatus = 'Paid';
        await order.save();

        await Payout.updateMany(
          { order: order._id, status: 'pending' },
          { $set: { status: 'eligible' } }
        );
      }

      return res.status(200).json({
        message: 'Product fulfillment status updated successfully.',
        order,
      });
    } catch (error) {
      console.error('Update order status error:', error);
      return res.status(500).json({
        message: 'Unable to update order status.',
      });
    }
  }
);


// Download PDF invoice for the logged-in customer's order
router.get(
    '/:id/invoice',
    auth,
    verifyRole('customer'),
    async (req, res) => {
        try {
            if (!mongoose.isValidObjectId(req.params.id)) {
                return res.status(400).json({
                    message: 'Invalid order ID.',
                });
            }

            const order = await Order.findOne({
                _id: req.params.id,
                customer: req.user.id,
            })
                .populate('customer', 'name email')
                .populate('products.product', 'title');

            if (!order) {
                return res.status(404).json({
                    message: 'Order not found.',
                });
            }

            const doc = new PDFDocument({ margin: 50 });

            const filename = `invoice-${order._id}.pdf`;

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="${filename}"`
            );

            doc.pipe(res);

            // Invoice heading
            doc.fontSize(24).font('Helvetica-Bold')
                .text('NEXVIA', { align: 'center' });

            doc.moveDown(0.5);
            doc.fontSize(18).text('INVOICE', { align: 'center' });

            doc.moveDown();

            doc.fontSize(10).font('Helvetica')
                .text(`Invoice ID: ${order._id}`)
                .text(`Order Date: ${new Date(order.createdAt).toLocaleDateString('en-IN')}`)
                .text(`Order Status: ${order.status}`)
                .text(`Payment Method: ${order.paymentMethod || 'N/A'}`)
                .text(`Payment Status: ${order.paymentStatus || 'N/A'}`);

            doc.moveDown();

            // Customer details
            doc.fontSize(13).font('Helvetica-Bold')
                .text('Bill To');

            doc.fontSize(10).font('Helvetica')
                .text(order.customer?.name || 'Customer')
                .text(order.customer?.email || '')
                .text(order.shippingAddress?.street || '')
                .text(
                    [
                        order.shippingAddress?.city,
                        order.shippingAddress?.state,
                        order.shippingAddress?.zipCode,
                        order.shippingAddress?.country,
                    ].filter(Boolean).join(', ')
                );

            doc.moveDown();

            // Products
            doc.fontSize(13).font('Helvetica-Bold')
                .text('Order Items');

            doc.moveDown(0.5);

            order.products.forEach((item, index) => {
                const productName =
                    item.product?.title || `Product ${index + 1}`;

                const quantity = item.quantity || 0;
                const lineTotal = Number(
                    item.lineTotal ??
                    (Number(item.unitPrice || 0) * quantity)
                );

                doc.fontSize(10).font('Helvetica')
                    .text(`${index + 1}. ${productName}`)
                    .text(`Quantity: ${quantity}`)
                    .text(
                        `Amount: Rs. ${lineTotal.toFixed(2)}`,
                        { align: 'right' }
                    );

                doc.moveDown(0.5);
            });

            doc.moveDown();

            // Amount summary
            const subtotal = Number(
                order.subtotalAmount ?? order.totalAmount ?? 0
            );
            const discount = Number(order.discountAmount || 0);
            const total = Number(order.totalAmount || 0);

            doc.fontSize(10).font('Helvetica')
                .text(`Subtotal: Rs. ${subtotal.toFixed(2)}`)
                .text(`Coupon: ${order.couponCode || 'N/A'}`)
                .text(`Discount: Rs. ${discount.toFixed(2)}`);

            doc.moveDown(0.5);

            doc.fontSize(14).font('Helvetica-Bold')
                .text(`Total Amount: Rs. ${total.toFixed(2)}`);

            doc.moveDown(2);

            doc.fontSize(10).font('Helvetica')
                .text('Thank you for shopping with Nexvia!', {
                    align: 'center',
                });

            doc.end();
        } catch (error) {
            console.error('Invoice generation error:', error);

            if (!res.headersSent) {
                return res.status(500).json({
                    message: 'Unable to generate invoice.',
                });
            }

            res.destroy(error);
        }
    }
);

module.exports = router;
