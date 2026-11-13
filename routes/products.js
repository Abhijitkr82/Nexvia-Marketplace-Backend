
console.log("PRODUCTS ROUTES FILE LOADED");

const express = require('express');
const Order = require('../models/Order');
const Product = require('../models/Product');

const {
  auth,
  verifyRole,
  requireApprovedVendor
} = require('../middleware/auth');

const {
  indexProduct,
  removeProductFromSearch
} = require('../services/productSearch');

const {
  GetObjectCommand
} = require('@aws-sdk/client-s3');

const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3 = require('../config/s3');

const router = express.Router();

// Generate temporary URLs for private S3 images.
// Keep the original S3 keys unchanged in MongoDB.
async function addImageUrls(product) {
  const data = product.toObject ? product.toObject() : { ...product };

  const images = Array.isArray(data.images) ? data.images : [];

  const imageUrls = await Promise.all(
    images.map(async (image) => {
      if (!image) return '';

      // Support older products that stored direct URLs.
      if (image.startsWith('http://') || image.startsWith('https://')) {
        return image;
      }

      return getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: image
        }),
        { expiresIn: 900 }
      );
    })
  );

  return {
    ...data,
    imageUrls
  };
}

async function addImageUrlsToMany(products) {
  return Promise.all(products.map(addImageUrls));
}

// Elasticsearch errors should not break MongoDB operations.
async function syncProductToSearch(action, productOrId) {
  try {
    if (action === 'delete') {
      await removeProductFromSearch(productOrId);
    } else {
      await indexProduct(productOrId);
    }
  } catch (error) {
    console.error(
      `Elasticsearch ${action} sync failed:`,
      error.message
    );
  }
}

// Get all products.
router.get('/', async (req, res) => {
  try {
    const products = await Product.find()
      .populate('vendor', 'name email');

    const productsWithUrls = await addImageUrlsToMany(products);

    return res.status(200).json(productsWithUrls);
  } catch (error) {
    console.error('Fetch all products error:', error.message);

    return res.status(500).json({
      message: 'Unable to fetch products.'
    });
  }
});

// Add product — vendors only.
router.post(
  '/add',
  auth,
  verifyRole('vendor'),
  requireApprovedVendor,
  async (req, res) => {
    try {
      const {
        title,
        description,
        price,
        category,
        stock,
        images
      } = req.body;

      if (
        typeof title !== 'string' ||
        !title.trim() ||
        typeof description !== 'string' ||
        !description.trim() ||
        typeof category !== 'string' ||
        !category.trim() ||
        price === undefined ||
        stock === undefined
      ) {
        return res.status(400).json({
          message:
            'Title, description, price, category and stock are required.'
        });
      }

      const parsedPrice = Number(price);
      const parsedStock = Number(stock);

      if (
        !Number.isFinite(parsedPrice) ||
        parsedPrice < 0 ||
        !Number.isInteger(parsedStock) ||
        parsedStock < 0
      ) {
        return res.status(400).json({
          message:
            'Price must be non-negative and stock must be a non-negative integer.'
        });
      }

      if (
        images !== undefined &&
        (!Array.isArray(images) ||
          !images.every(image => typeof image === 'string'))
      ) {
        return res.status(400).json({
          message: 'Images must be an array of strings.'
        });
      }

      const product = await Product.create({
        title: title.trim(),
        description: description.trim(),
        price: parsedPrice,
        category: category.trim(),
        stock: parsedStock,
        images: images || [],
        vendor: req.user.id
      });

      await syncProductToSearch('index', product);

      const productWithUrls = await addImageUrls(product);

      return res.status(201).json({
        message: 'Product added successfully!',
        product: productWithUrls
      });
    } catch (error) {
      console.error('Add product error:', error.message);

      return res.status(500).json({
        message: 'Unable to add product.'
      });
    }
  }
);

// Get products belonging to the logged-in vendor.
router.get('/mine', auth, verifyRole('vendor'), async (req, res) => {
  try {
    const products = await Product.find({
      vendor: req.user.id
    }).sort({ createdAt: -1 });

    const productsWithUrls = await addImageUrlsToMany(products);

    return res.status(200).json(productsWithUrls);
  } catch (error) {
    console.error('Fetch vendor products error:', error.message);

    return res.status(500).json({
      message: 'Unable to fetch your products.'
    });
  }
});

// Update own product — vendors only.
router.put(
  '/:id',
  auth,
  verifyRole('vendor'),
  requireApprovedVendor,
  async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);

      if (!product) {
        return res.status(404).json({
          message: 'Product not found.'
        });
      }

      if (product.vendor.toString() !== req.user.id) {
        return res.status(403).json({
          message: 'You can only update your own products.'
        });
      }

      const allowedFields = [
        'title',
        'description',
        'price',
        'category',
        'stock',
        'images'
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

      if ('title' in updates) {
        if (
          typeof updates.title !== 'string' ||
          !updates.title.trim()
        ) {
          return res.status(400).json({
            message: 'Invalid product title.'
          });
        }

        updates.title = updates.title.trim();
      }

      if ('description' in updates) {
        if (
          typeof updates.description !== 'string' ||
          !updates.description.trim()
        ) {
          return res.status(400).json({
            message: 'Invalid description.'
          });
        }

        updates.description = updates.description.trim();
      }

      if ('category' in updates) {
        if (
          typeof updates.category !== 'string' ||
          !updates.category.trim()
        ) {
          return res.status(400).json({
            message: 'Invalid category.'
          });
        }

        updates.category = updates.category.trim();
      }

      if ('price' in updates) {
        updates.price = Number(updates.price);

        if (
          !Number.isFinite(updates.price) ||
          updates.price < 0
        ) {
          return res.status(400).json({
            message: 'Invalid price.'
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
            message: 'Invalid stock quantity.'
          });
        }
      }

      if (
        'images' in updates &&
        (!Array.isArray(updates.images) ||
          !updates.images.every(image => typeof image === 'string'))
      ) {
        return res.status(400).json({
          message: 'Invalid images array.'
        });
      }

      const updatedProduct = await Product.findByIdAndUpdate(
        req.params.id,
        { $set: updates },
        { new: true, runValidators: true }
      );

      await syncProductToSearch('update', updatedProduct);

      const productWithUrls = await addImageUrls(updatedProduct);

      return res.status(200).json({
        message: 'Product updated successfully!',
        product: productWithUrls
      });
    } catch (error) {
      console.error('Update product error:', error.message);

      return res.status(500).json({
        message: 'Unable to update product.'
      });
    }
  }
);

// Delete own product — vendors only.
router.delete(
  '/:id',
  auth,
  verifyRole('vendor'),
  requireApprovedVendor,
  async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);

      if (!product) {
        return res.status(404).json({
          message: 'Product not found.'
        });
      }

      if (product.vendor.toString() !== req.user.id) {
        return res.status(403).json({
          message: 'You can only delete your own products.'
        });
      }

      const linkedOrder = await Order.exists({
        'products.product': product._id
      });

      if (linkedOrder) {
        return res.status(409).json({
          message:
            'This product is linked to an order and cannot be deleted. Set its stock to zero instead.'
        });
      }

      await Product.findByIdAndDelete(req.params.id);

      await syncProductToSearch('delete', product._id);

      return res.status(200).json({
        message: 'Product deleted successfully!'
      });
    } catch (error) {
      console.error('Delete product error:', error.message);

      return res.status(500).json({
        message: 'Unable to delete product.'
      });
    }
  }
);

module.exports = router;
