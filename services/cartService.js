
const redisClient = require('../config/redis');

const CART_TTL_SECONDS = 7 * 24 * 60 * 60;

function getCartKey(userId) {
  if (!userId) {
    throw new Error('User ID is required for cart storage.');
  }

  return `nexvia:cart:${userId}`;
}

async function getCart(userId) {
  const key = getCartKey(userId);
  const savedCart = await redisClient.get(key);

  if (!savedCart) {
    return [];
  }

  try {
    const cart = JSON.parse(savedCart);

    if (!Array.isArray(cart)) {
      throw new Error('Invalid cart format in Redis.');
    }

    return cart;
  } catch (error) {
    await redisClient.del(key);
    throw new Error('Cart data was invalid and has been cleared.');
  }
}

async function saveCart(userId, items) {
  if (!Array.isArray(items)) {
    throw new Error('Cart items must be an array.');
  }

  const key = getCartKey(userId);

  if (items.length === 0) {
    await redisClient.del(key);
    return [];
  }

  const normalizedItems = [];
  const quantities = new Map();

  for (const item of items) {
    const productId = String(item.productId || '');
    const quantity = Number(item.quantity);

    if (
      !productId ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1
    ) {
      throw new Error('Each cart item needs a product ID and a positive integer quantity.');
    }

    quantities.set(
      productId,
      (quantities.get(productId) || 0) + quantity
    );
  }

  for (const [productId, quantity] of quantities) {
    if (!Number.isSafeInteger(quantity)) {
      throw new Error('Invalid total product quantity.');
    }

    normalizedItems.push({ productId, quantity });
  }

  await redisClient.set(key, JSON.stringify(normalizedItems), {
    EX: CART_TTL_SECONDS,
  });

  return normalizedItems;
}

async function clearCart(userId) {
  await redisClient.del(getCartKey(userId));
}

module.exports = {
  getCart,
  saveCart,
  clearCart,
};
