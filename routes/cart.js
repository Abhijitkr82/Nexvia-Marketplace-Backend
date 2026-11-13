
const express = require('express');
const mongoose = require('mongoose');
const { auth, verifyRole } = require('../middleware/auth');
const Product = require('../models/Product');
const {
  getCart,
  saveCart,
  clearCart,
} = require('../services/cartService');

const router = express.Router();

// All cart routes require an authenticated customer.
router.use(auth, verifyRole('customer'));

function isValidQuantity(quantity) {
  return Number.isSafeInteger(quantity) && quantity >= 1;
}

// Load the customer's cart from Redis and hydrate product details from MongoDB.
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const savedItems = await getCart(userId);

    if (savedItems.length === 0) {
      return res.status(200).json([]);
    }

    const validItems = savedItems.filter(
      (item) =>
        mongoose.isValidObjectId(item.productId) &&
        isValidQuantity(item.quantity)
    );

    const productIds = validItems.map((item) => item.productId);

    const products = await Product.find({
      _id: { $in: productIds },
    }).lean();

    const productMap = new Map(
      products.map((product) => [
        String(product._id),
        product,
      ])
    );

    const hydratedCart = [];

    for (const item of validItems) {
      const product = productMap.get(String(item.productId));

      // Skip products that have been deleted.
      if (!product) {
        continue;
      }

      hydratedCart.push({
        ...product,
        _id: product._id,
        quantity: item.quantity,
      });
    }

    // Remove deleted or invalid products from the stored cart.
    if (hydratedCart.length !== savedItems.length) {
      await saveCart(
        userId,
        hydratedCart.map((item) => ({
          productId: String(item._id),
          quantity: item.quantity,
        }))
      );
    }

    return res.status(200).json(hydratedCart);
  } catch (error) {
    console.error('Get cart error:', error.message);

    return res.status(500).json({
      message: 'Failed to load cart.',
    });
  }
});

// Replace the customer's Redis cart with the submitted items.
router.put('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { items } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({
        message: 'Items must be an array.',
      });
    }

    if (items.length > 100) {
      return res.status(400).json({
        message: 'A cart cannot contain more than 100 item entries.',
      });
    }

    // An empty array clears the cart.
    if (items.length === 0) {
      await clearCart(userId);
      return res.status(200).json([]);
    }

    const quantities = new Map();

    for (const item of items) {
      const productId = String(item?.productId || '');
      const quantity = item?.quantity;

      if (!mongoose.isValidObjectId(productId)) {
        return res.status(400).json({
          message: 'A cart item contains an invalid product ID.',
        });
      }

      if (!isValidQuantity(quantity)) {
        return res.status(400).json({
          message: 'Each quantity must be a positive integer.',
        });
      }

      const id = String(new mongoose.Types.ObjectId(productId));

      quantities.set(
        id,
        (quantities.get(id) || 0) + quantity
      );

      if (!Number.isSafeInteger(quantities.get(id))) {
        return res.status(400).json({
          message: 'Invalid total quantity for a product.',
        });
      }
    }

    const requestedItems = Array.from(
      quantities,
      ([productId, quantity]) => ({
        productId,
        quantity,
      })
    );

    const products = await Product.find({
      _id: {
        $in: requestedItems.map((item) => item.productId),
      },
    }).lean();

    const productMap = new Map(
      products.map((product) => [
        String(product._id),
        product,
      ])
    );

    // Validate every product and its currently available stock.
    for (const item of requestedItems) {
      const product = productMap.get(item.productId);

      if (!product) {
        return res.status(404).json({
          message: `Product not found: ${item.productId}`,
        });
      }

      if (
        !Number.isFinite(Number(product.stock)) ||
        Number(product.stock) < 0
      ) {
        return res.status(409).json({
          message: `Stock information is unavailable for ${product.title || 'a product'}.`,
        });
      }

      if (item.quantity > Number(product.stock)) {
        return res.status(409).json({
          message: `Requested quantity exceeds available stock for ${product.title || 'a product'}.`,
          productId: item.productId,
          availableStock: Number(product.stock),
        });
      }
    }

    // Save only product IDs and quantities in Redis.
    const savedCart = await saveCart(userId, requestedItems);

    // Return full product details for the frontend.
    const hydratedCart = savedCart.map((item) => {
      const product = productMap.get(item.productId);

      return {
        ...product,
        _id: product._id,
        quantity: item.quantity,
      };
    });

    return res.status(200).json(hydratedCart);
  } catch (error) {
    console.error('Update cart error:', error.message);

    return res.status(500).json({
      message: 'Failed to update cart.',
    });
  }
});

// Clear the customer's Redis cart.
router.delete('/', async (req, res) => {
  try {
    await clearCart(req.user.id);

    return res.status(200).json({
      message: 'Cart cleared successfully.',
      cart: [],
    });
  } catch (error) {
    console.error('Clear cart error:', error.message);

    return res.status(500).json({
      message: 'Failed to clear cart.',
    });
  }
});

module.exports = router;
