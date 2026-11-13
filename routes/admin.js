
const express = require('express');
const router = express.Router();

const { auth, verifyRole } = require('../middleware/auth');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { indexProduct } = require('../services/productSearch');

// ========================================
// 1. ADMIN DASHBOARD STATISTICS
// GET /api/admin/stats
// ========================================
router.get('/stats', auth, verifyRole('admin'), async (req, res) => {
  try {
    const [
      totalUsers,
      totalCustomers,
      totalVendors,
      totalProducts,
      totalOrders,
      pendingOrders,
      deliveredOrders,
      totalRevenue
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'customer' }),
      User.countDocuments({ role: 'vendor' }),
      Product.countDocuments(),
      Order.countDocuments(),
      Order.countDocuments({ status: 'Pending' }),
      Order.countDocuments({ status: 'Delivered' }),
      Order.aggregate([
        { $match: { status: { $ne: 'Cancelled' } } },
        {
          $group: {
            _id: null,
            total: { $sum: '$totalAmount' }
          }
        }
      ])
    ]);

    return res.status(200).json({
      totalUsers,
      totalCustomers,
      totalVendors,
      totalProducts,
      totalOrders,
      pendingOrders,
      deliveredOrders,
      totalRevenue: totalRevenue[0]?.total || 0
    });
  } catch (error) {
    console.error('Admin stats error:', error.message);

    return res.status(500).json({
      message: 'Unable to fetch admin statistics.'
    });
  }
});

// ========================================
// 2. ADMIN USER MANAGEMENT
// GET /api/admin/users
// ========================================
router.get('/users', auth, verifyRole('admin'), async (req, res) => {
  try {
    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      count: users.length,
      users
    });
  } catch (error) {
    console.error('Admin users error:', error.message);

    return res.status(500).json({
      message: 'Unable to fetch users.'
    });
  }
});

// ========================================
// 3. ADMIN VENDOR MANAGEMENT
// GET /api/admin/vendors
// ========================================
router.get('/vendors', auth, verifyRole('admin'), async (req, res) => {
  try {
    const vendors = await User.find({ role: 'vendor' })
      .select('name email phone address vendorStatus createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      count: vendors.length,
      vendors
    });
  } catch (error) {
    console.error('Admin vendors error:', error.message);

    return res.status(500).json({
      message: 'Unable to fetch vendors.'
    });
  }
});


// ========================================
// 4. ADMIN APPROVE / REJECT VENDOR
// PUT /api/admin/vendors/:id/status
// ========================================
router.put(
  '/vendors/:id/status',
  auth,
  verifyRole('admin'),
  async (req, res) => {
    try {
      const { status } = req.body;

      if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({
          message: 'Status must be approved or rejected.'
        });
      }

      const vendor = await User.findOne({
        _id: req.params.id,
        role: 'vendor'
      });

      if (!vendor) {
        return res.status(404).json({
          message: 'Vendor not found.'
        });
      }

      if (
        vendor.vendorStatus &&
        !['pending', 'not_applicable'].includes(vendor.vendorStatus)
      ) {
        return res.status(400).json({
          message: `Vendor is already ${vendor.vendorStatus}.`
        });
      }

      vendor.vendorStatus = status;
      await vendor.save();

      return res.status(200).json({
        message: `Vendor ${status} successfully.`,
        vendor: {
          id: vendor._id,
          name: vendor.name,
          email: vendor.email,
          vendorStatus: vendor.vendorStatus
        }
      });
    } catch (error) {
      console.error('Vendor approval error:', error.message);

      return res.status(500).json({
        message: 'Unable to update vendor status.'
      });
    }
  }
);

// ========================================
// 5. ADMIN PRODUCT MANAGEMENT
// GET /api/admin/products
// ========================================
router.get('/products', auth, verifyRole('admin'), async (req, res) => {
  try {
    const products = await Product.find()
      .populate('vendor', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const formattedProducts = products.map((product) => ({
      ...product,
      vendor: product.vendor || null
    }));

    return res.status(200).json({
      count: formattedProducts.length,
      products: formattedProducts
    });
  } catch (error) {
    console.error('Admin products error:', error.message);

    return res.status(500).json({
      message: 'Unable to fetch products.'
    });
  }
});

// ========================================
// 6. ADMIN UPDATE PRODUCT
// PUT /api/admin/products/:id
// ========================================
router.put(
  '/products/:id',
  auth,
  verifyRole('admin'),
  async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);

      if (!product) {
        return res.status(404).json({
          message: 'Product not found.'
        });
      }

      const allowedFields = [
        'title',
        'description',
        'price',
        'category',
        'stock'
      ];

      const updates = {};

      for (const field of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(req.body, field)) {
          updates[field] = req.body[field];
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          message: 'No valid product fields provided.'
        });
      }

      for (const field of ['title', 'description', 'category']) {
        if (field in updates) {
          if (
            typeof updates[field] !== 'string' ||
            !updates[field].trim()
          ) {
            return res.status(400).json({
              message: `Invalid ${field}.`
            });
          }

          updates[field] = updates[field].trim();
        }
      }

      if ('price' in updates) {
        updates.price = Number(updates.price);

        if (!Number.isFinite(updates.price) || updates.price < 0) {
          return res.status(400).json({
            message: 'Price must be a non-negative number.'
          });
        }
      }

      if ('stock' in updates) {
        updates.stock = Number(updates.stock);

        if (
          !Number.isInteger(updates.stock) ||
          updates.stock < 0
        ) {
          return res.status(400).json({
            message: 'Stock must be a non-negative integer.'
          });
        }
      }

      const updatedProduct = await Product.findByIdAndUpdate(
        req.params.id,
        { $set: updates },
        { new: true, runValidators: true }
      ).populate('vendor', 'name email');

      // Keep Elasticsearch aligned with the MongoDB product record.
      try {
        await indexProduct(updatedProduct);
      } catch (searchError) {
        console.error('Admin product search sync failed:', searchError.message);
      }

      return res.status(200).json({
        message: 'Product updated successfully!',
        product: updatedProduct
      });
    } catch (error) {
      console.error('Admin update product error:', error.message);

      return res.status(500).json({
        message: 'Unable to update product.'
      });
    }
  }
);

// ========================================
// 7. ADMIN DELETE PRODUCT
// DELETE /api/admin/products/:id
// ========================================
router.delete(
  '/products/:id',
  auth,
  verifyRole('admin'),
  async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);

      if (!product) {
        return res.status(404).json({
          message: 'Product not found.'
        });
      }

      // Protect product references in existing orders.
      const linkedOrder = await Order.exists({
        'products.product': product._id
      });

      if (linkedOrder) {
        return res.status(409).json({
          message:
            'This product is linked to existing orders and cannot be deleted.'
        });
      }

      await Product.findByIdAndDelete(product._id);

      return res.status(200).json({
        message: 'Product deleted successfully!'
      });
    } catch (error) {
      console.error('Admin delete product error:', error.message);

      return res.status(500).json({
        message: 'Unable to delete product.'
      });
    }
  }
);

// ========================================
// 8. ADMIN ORDER MANAGEMENT
// GET /api/admin/orders
// ========================================
router.get('/orders', auth, verifyRole('admin'), async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('customer', 'name email')
      .populate('products.product', 'title price')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      count: orders.length,
      orders
    });
  } catch (error) {
    console.error('Admin orders error:', error.message);

    return res.status(500).json({
      message: 'Unable to fetch orders.'
    });
  }
});

// ========================================
// 9. ADMIN UPDATE ORDER STATUS
// PUT /api/admin/orders/:id/status
// ========================================
router.put(
  '/orders/:id/status',
  auth,
  verifyRole('admin'),
  async (req, res) => {
    try {
      const { status } = req.body;

      // Cancellation has a separate stock/refund workflow and is not
      // available through this simple admin fulfillment endpoint.
      const allowedStatuses = [
        'Pending',
        'Processing',
        'Shipped',
        'Delivered'
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: 'Invalid order status.'
        });
      }

      const order = await Order.findById(req.params.id);

      if (!order) {
        return res.status(404).json({
          message: 'Order not found.'
        });
      }

      if (order.status === 'Cancelled') {
        return res.status(409).json({
          message: 'Cancelled orders cannot be updated.'
        });
      }

      order.status = status;
      order.products.forEach((item) => {
        item.fulfillmentStatus = status;
      });
      await order.save();

      return res.status(200).json({
        message: 'Order status updated successfully.',
        order
      });
    } catch (error) {
      console.error('Update order status error:', error.message);

      return res.status(500).json({
        message: 'Unable to update order status.'
      });
    }
  }
);

module.exports = router;
