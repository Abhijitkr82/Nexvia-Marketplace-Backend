
require('dotenv').config();

const redisClient = require('./config/redis');

async function testRedis() {
  try {
    await redisClient.connect();

    await redisClient.set('nexvia:test', 'Redis Working!');
    const result = await redisClient.get('nexvia:test');

    console.log('Redis Test Result:', result);
  } catch (error) {
    console.error('Redis test failed:', error.message);
  } finally {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  }
}

testRedis();
