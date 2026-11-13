const express = require('express');
const elasticClient = require('../config/elasticsearch');
const Product = require('../models/Product');

const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3 = require('../config/s3');

const router = express.Router();
const INDEX = process.env.ELASTICSEARCH_INDEX || 'products';

// Generate signed URLs for product images
async function addImageUrls(product) {
  const images = Array.isArray(product.images) ? product.images : [];

  const imageUrls = await Promise.all(
    images.map(async (image) => {
      if (!image) return '';

      // Keep existing external image URLs unchanged
      if (/^https?:\/\//i.test(image)) {
        return image;
      }

      // Generate signed URL for S3 images
      return getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: image,
        }),
        { expiresIn: 900 }
      );
    })
  );

  return {
    ...product,
    imageUrls,
  };
}

// GET /api/search
router.get('/', async (req, res) => {
  try {
    const { q, category, sort } = req.query;

    // Build Elasticsearch query
    const must = [];

    if (q) {
      must.push({
        multi_match: {
          query: q,
          fields: ['title^3', 'description', 'category'],
          fuzziness: 'AUTO',
        },
      });
    }

    if (category) {
      must.push({
        match_phrase: {
          category: category,
        },
      });
    }

    const searchQuery = {
      bool: {
        must: must.length ? must : [{ match_all: {} }],
      },
    };

    // Elasticsearch search
    const result = await elasticClient.search({
      index: INDEX,
      query: searchQuery,
      sort: [{ createdAt: 'desc' }],
      size: 100,
    });

    // Get matching product IDs
    const productIds = result.hits.hits.map(
      (hit) => hit._id
    );

    if (!productIds.length) {
      return res.status(200).json({
        total: 0,
        products: [],
      });
    }

    // Fetch products from MongoDB
    const mongoProducts = await Product.find({
      _id: { $in: productIds },
    }).lean();

    // Preserve Elasticsearch result order
    let products = productIds
      .map((id) =>
        mongoProducts.find(
          (product) => product._id.toString() === id
        )
      )
      .filter(Boolean);

    // Sorting
    if (sort === 'price-low') {
      products.sort((a, b) => a.price - b.price);
    } else if (sort === 'price-high') {
      products.sort((a, b) => b.price - a.price);
    } else if (sort === 'newest') {
      products.sort(
        (a, b) =>
          new Date(b.createdAt) - new Date(a.createdAt)
      );
    }

    // Generate image URLs for all products
    const productsWithUrls = await Promise.all(
      products.map(addImageUrls)
    );

    return res.status(200).json({
      total: productsWithUrls.length,
      products: productsWithUrls,
    });
  } catch (error) {
    console.error('Search Error:', error);

    return res.status(500).json({
      message: 'Something went wrong while searching products',
      error: error.message,
    });
  }
});

module.exports = router;