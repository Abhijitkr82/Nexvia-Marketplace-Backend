require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const paymentRoutes = require('./routes/payment');
const searchRoutes = require('./routes/search');
const redisClient = require('./config/redis');
const cartRoutes = require('./routes/cart');
const reviewRoutes = require('./routes/reviews');
const payoutRoutes = require('./routes/payouts');
const couponRoutes = require('./routes/coupons');
const uploadRoutes = require('./routes/uploads');
const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Use Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/uploads', uploadRoutes);
app.get('/', (req, res) => {
  res.send('Nexvia Multi-Vendor Marketplace API is running! 🚀');
});

// Database connection & server start
// Database connection & server start
const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      family: 4,
    });

    console.log('MongoDB Connected Successfully 🚀');

    // Connect Redis once for the running backend
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }

    await redisClient.ping();
    console.log('Redis Ready for Nexvia Cart 🚀');

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Server startup failed:', err.message);
    process.exit(1);
  }
}

startServer();