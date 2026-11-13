
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
        index: true
    },
    customer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
        validate: {
            validator: Number.isInteger,
            message: 'Rating must be a whole number from 1 to 5.'
        }
    },
    comment: {
        type: String,
        required: true,
        trim: true,
        minlength: 3,
        maxlength: 1000
    }
}, {
    timestamps: true
});

// One customer can review a product only once.
reviewSchema.index(
    { product: 1, customer: 1 },
    { unique: true }
);

const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;
