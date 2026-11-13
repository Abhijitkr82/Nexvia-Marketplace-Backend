
const express = require('express');
const mongoose = require('mongoose');

const Review = require('../models/Review');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { auth, verifyRole } = require('../middleware/auth');

const router = express.Router();

// Submit a product review
router.post(
    '/',
    auth,
    verifyRole('customer'),
    async (req, res) => {
        try {
            const { productId, rating, comment } = req.body;

            if (!mongoose.isValidObjectId(productId)) {
                return res.status(400).json({
                    message: 'Invalid product ID.'
                });
            }

            if (
                !Number.isInteger(rating) ||
                rating < 1 ||
                rating > 5
            ) {
                return res.status(400).json({
                    message: 'Rating must be a whole number from 1 to 5.'
                });
            }

            if (
                typeof comment !== 'string' ||
                comment.trim().length < 3 ||
                comment.trim().length > 1000
            ) {
                return res.status(400).json({
                    message: 'Review must contain 3 to 1000 characters.'
                });
            }

            const product = await Product.findById(productId);

            if (!product) {
                return res.status(404).json({
                    message: 'Product not found.'
                });
            }

            // Customer must have a delivered order containing this product.
            const deliveredOrder = await Order.findOne({
                customer: req.user.id,
                status: 'Delivered',
                'products.product': new mongoose.Types.ObjectId(productId)
            });

            if (!deliveredOrder) {
                return res.status(403).json({
                    message: 'You can review this product only after it has been delivered.'
                });
            }

            const review = await Review.create({
                product: productId,
                customer: req.user.id,
                rating,
                comment: comment.trim()
            });

            // Recalculate average rating and review count.
            const stats = await Review.aggregate([
                {
                    $match: {
                        product: new mongoose.Types.ObjectId(productId)
                    }
                },
                {
                    $group: {
                        _id: '$product',
                        averageRating: { $avg: '$rating' },
                        reviewCount: { $sum: 1 }
                    }
                }
            ]);

            await Product.findByIdAndUpdate(productId, {
                averageRating: Number(stats[0].averageRating.toFixed(1)),
                reviewCount: stats[0].reviewCount
            });

            return res.status(201).json({
                message: 'Review submitted successfully.',
                review
            });
        } catch (error) {
            console.error('Submit review error:', error);

            if (error.code === 11000) {
                return res.status(409).json({
                    message: 'You have already reviewed this product.'
                });
            }

            return res.status(500).json({
                message: 'Unable to submit review.'
            });
        }
    }
);

// Get all reviews for a product
router.get('/:productId', async (req, res) => {
    try {
        const { productId } = req.params;

        if (!mongoose.isValidObjectId(productId)) {
            return res.status(400).json({
                message: 'Invalid product ID.'
            });
        }

        const product = await Product.findById(productId)
            .select('title averageRating reviewCount');

        if (!product) {
            return res.status(404).json({
                message: 'Product not found.'
            });
        }

        const reviews = await Review.find({ product: productId })
            .populate('customer', 'name')
            .sort({ createdAt: -1 });

        return res.status(200).json({
            product,
            reviews
        });
    } catch (error) {
        console.error('Fetch reviews error:', error);

        return res.status(500).json({
            message: 'Unable to fetch product reviews.'
        });
    }
});

module.exports = router;
