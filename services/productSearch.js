
const elasticClient = require('../config/elasticsearch');

const INDEX = process.env.ELASTICSEARCH_INDEX || 'products';

function toSearchDocument(product) {
  const item = product.toObject
    ? product.toObject()
    : product;

  return {
    title: item.title,
    description: item.description,
    category: item.category,
    price: item.price,
    stock: item.stock,
    images: item.images || [],
    vendor: item.vendor?._id
      ? item.vendor._id.toString()
      : item.vendor?.toString(),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

async function indexProduct(product) {
  await elasticClient.index({
    index: INDEX,
    id: product._id.toString(),
    document: toSearchDocument(product),
    refresh: 'wait_for'
  });
}

async function removeProductFromSearch(productId) {
  try {
    await elasticClient.delete({
      index: INDEX,
      id: productId.toString(),
      refresh: 'wait_for'
    });
  } catch (error) {
    if (error.statusCode !== 404) {
      throw error;
    }
  }
}

module.exports = {
  indexProduct,
  removeProductFromSearch
};
