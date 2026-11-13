
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verify JWT token
const auth = (req, res, next) => {
  const authHeader = req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Access denied. No token provided.'
    });
  }

  if (!process.env.JWT_SECRET) {
    return res.status(500).json({
      message: 'Server authentication configuration is missing.'
    });
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    return res.status(401).json({
      message: 'Access denied. No token provided.'
    });
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    return res.status(401).json({
      message: 'Invalid or expired token.'
    });
  }
};

// Role-based authorization
const verifyRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'Forbidden. You do not have the required permissions.'
      });
    }

    next();
  };
};

// Check the vendor's latest approval status from database
const requireApprovedVendor = async (req, res, next) => {
  if (!req.user || req.user.role !== 'vendor') {
    return res.status(403).json({
      message: 'Vendor access required.',
    });
  }

  let user;

  try {
    user = await User.findById(req.user.id)
      .select('role vendorStatus');
  } catch (error) {
    console.error('Vendor approval database error:', error);

    return res.status(500).json({
      message: 'Unable to verify vendor approval status.',
    });
  }

  if (!user || user.role !== 'vendor') {
    return res.status(403).json({
      message: 'Vendor account not found.',
    });
  }

  if (user.vendorStatus !== 'approved') {
    return res.status(403).json({
      message: `Your vendor account is ${user.vendorStatus || 'pending'}. Admin approval is required.`,
    });
  }

  return next();
};

module.exports = {
  auth,
  verifyRole,
  requireApprovedVendor
};
