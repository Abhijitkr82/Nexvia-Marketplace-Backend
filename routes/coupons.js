const express = require('express');
const mongoose = require('mongoose');
const Coupon = require('../models/Coupon');
const { auth, verifyRole } = require('../middleware/auth');

const router = express.Router();

// Admin: Create coupon
router.post('/', auth, verifyRole('admin'), async (req, res) => {
  try {
    const {
      code,
      discountType,
      discountValue,
      maxDiscount,
      minOrderAmount,
      usageLimit,
      startsAt,
      expiresAt,
    } = req.body;

    if (
      !code ||
      !discountType ||
      discountValue === undefined ||
      !expiresAt
    ) {
      return res.status(400).json({
        message: 'Code, discount type, discount value and expiry date are required',
      });
    }

    if (!['percentage', 'fixed'].includes(discountType)) {
      return res.status(400).json({ message: 'Invalid discount type' });
    }

    const normalizedCode = code.trim().toUpperCase();

    const existingCoupon = await Coupon.findOne({ code: normalizedCode });

    if (existingCoupon) {
      return res.status(409).json({ message: 'Coupon code already exists' });
    }

    const coupon = await Coupon.create({
      code: normalizedCode,
      discountType,
      discountValue,
      maxDiscount,
      minOrderAmount,
      usageLimit,
      startsAt: startsAt || new Date(),
      expiresAt,
    });

    res.status(201).json({
      message: 'Coupon created successfully',
      coupon,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to create coupon',
      error: error.message,
    });
  }
});

// Admin: Get all coupons
router.get('/', auth, verifyRole('admin'), async (req, res) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 });

    res.json({ coupons });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to fetch coupons',
      error: error.message,
    });
  }
});

// Admin: Update coupon
router.patch('/:id', auth, verifyRole('admin'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid coupon ID' });
    }

    const allowedFields = [
      'discountType',
      'discountValue',
      'maxDiscount',
      'minOrderAmount',
      'usageLimit',
      'startsAt',
      'expiresAt',
      'isActive',
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (
      updates.discountType &&
      !['percentage', 'fixed'].includes(updates.discountType)
    ) {
      return res.status(400).json({ message: 'Invalid discount type' });
    }

    const coupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!coupon) {
      return res.status(404).json({ message: 'Coupon not found' });
    }

    res.json({
      message: 'Coupon updated successfully',
      coupon,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to update coupon',
      error: error.message,
    });
  }
});

// Admin: Deactivate coupon
router.delete('/:id', auth, verifyRole('admin'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid coupon ID' });
    }

    const coupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false } },
      { new: true }
    );

    if (!coupon) {
      return res.status(404).json({ message: 'Coupon not found' });
    }

    res.json({
      message: 'Coupon deactivated successfully',
      coupon,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to deactivate coupon',
      error: error.message,
    });
  }
});

module.exports = router;