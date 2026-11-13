
const express = require('express');
const router = express.Router();

const Payout = require('../models/Payout');
const { auth, verifyRole } = require('../middleware/auth');

// Vendor: apne payout records dekh sakta hai.
router.get(
  '/my-payouts',
  auth,
  verifyRole('vendor'),
  async (req, res) => {
    try {
      const payouts = await Payout.find({
        vendor: req.user.id,
      })
        .populate('order', 'totalAmount status paymentStatus')
        .sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        count: payouts.length,
        payouts,
      });
    } catch (error) {
      console.error('Vendor payouts error:', error);
      res.status(500).json({
        success: false,
        message: 'Unable to fetch payouts.',
      });
    }
  }
);

// Admin: sabhi vendors ke payout records dekh sakta hai.
router.get('/', auth, verifyRole('admin'), async (req, res) => {
  try {
    const payouts = await Payout.find()
      .populate('vendor', 'name email')
      .populate('order', 'totalAmount status paymentStatus')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: payouts.length,
      payouts,
    });
  } catch (error) {
    console.error('Admin payouts error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to fetch payouts.',
    });
  }
});

module.exports = router;
