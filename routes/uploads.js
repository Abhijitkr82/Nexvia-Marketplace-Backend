
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');

const {
  PutObjectCommand,
  GetObjectCommand
} = require('@aws-sdk/client-s3');

const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = require('../config/s3');

const {
  auth,
  verifyRole,
  requireApprovedVendor
} = require('../middleware/auth');

const router = express.Router();

// Store uploaded images temporarily in memory.
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB
  },
  fileFilter: (req, file, callback) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return callback(
        new Error('Only JPG, PNG and WEBP images are allowed.')
      );
    }

    callback(null, true);
  }
});

// Upload product image to private S3 bucket.
router.post(
  '/product-image',
  auth,
  verifyRole('vendor'),
  requireApprovedVendor,
  upload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          message: 'Please select an image to upload.'
        });
      }

      const extension = path.extname(req.file.originalname).toLowerCase();
      const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

      if (!allowedExtensions.includes(extension)) {
        return res.status(400).json({
          message: 'Invalid image file extension.'
        });
      }

      const fileKey = `products/${req.user.id}/${crypto.randomUUID()}${extension}`;

      // Upload image to S3.
      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: fileKey,
          Body: req.file.buffer,
          ContentType: req.file.mimetype
        })
      );

      // Generate temporary URL to view the private image.
      const imageUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: fileKey
        }),
        { expiresIn: 900 }
      );

      return res.status(201).json({
        message: 'Product image uploaded successfully!',
        imageKey: fileKey,
        imageUrl
      });

    } catch (error) {
      console.error('S3 image upload error:', error);

      return res.status(500).json({
        message: 'Unable to upload product image.'
      });
    }
  }
);

// Handle Multer validation errors.
router.use((err, req, res, next) => {
  if (err) {
    return res.status(400).json({
      message: err.message || 'Image upload failed.'
    });
  }

  next();
});

module.exports = router;
