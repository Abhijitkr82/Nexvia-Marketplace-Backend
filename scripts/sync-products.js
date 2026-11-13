
require('dotenv').config();

const mongoose = require('mongoose');
const Product = require('../models/Product');
const elasticClient = require('../config/elasticsearch');

async function syncProducts() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      family: 4
    });

    console.log('✅ MongoDB connected');

    const products = await Product.find().lean();

    const index = process.env.ELASTICSEARCH_INDEX || 'products';

    await elasticClient.indices.create(
      {
        index,
        mappings: {
          properties: {
            title: { type: 'text' },
            description: { type: 'text' },
            category: { type: 'keyword' },
            price: { type: 'double' },
            stock: { type: 'integer' },
            images: { type: 'keyword' },
            vendor: { type: 'keyword' },
            createdAt: { type: 'date' },
            updatedAt: { type: 'date' }
          }
        }
      },
      { ignore: [400] }
    );

    if (products.length === 0) {
      console.log('ℹ️ No products found in MongoDB');
      return;
    }

    const operations = products.flatMap((product) => [
      {
        index: {
          _index: index,
          _id: product._id.toString()
        }
      },
      {
        title: product.title,
        description: product.description,
        category: product.category,
        price: product.price,
        stock: product.stock,
        images: product.images || [],
        vendor: product.vendor?.toString(),
        createdAt: product.createdAt,
        updatedAt: product.updatedAt
      }
    ]);

    const result = await elasticClient.bulk({
      operations,
      refresh: true
    });

    if (result.errors) {
      const failed = result.items.filter(
        (item) => item.index?.error
      );

      console.error('❌ Failed product records:', failed.length);
      console.error(JSON.stringify(failed.slice(0, 3), null, 2));
    }

    console.log(`📦 MongoDB products found: ${products.length}`);
    console.log(
      `✅ Successfully indexed: ${
        result.items.filter((item) => item.index?.result !== 'error').length
      }`
    );
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

syncProducts();
