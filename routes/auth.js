
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, phone, address } = req.body;

    if (
      typeof name !== 'string' ||
      !name.trim() ||
      typeof email !== 'string' ||
      !email.trim() ||
      typeof password !== 'string' ||
      password.length < 8
    ) {
      return res.status(400).json({
        message: 'Name, valid email and password (minimum 8 characters) are required.'
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedRole = role || 'customer';

    if (!['customer', 'vendor'].includes(normalizedRole)) {
      return res.status(400).json({
        message: 'Role must be customer or vendor.'
      });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({
        message: 'User already exists with this email.'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: normalizedRole,
      phone,
      address
    });


    return res.status(201).json({
      message: 'User registered successfully!',
      userId: newUser._id,
      role: newUser.role,
      vendorStatus: newUser.vendorStatus
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: 'This email is already registered.'
      });
    }

    return res.status(500).json({
      message: 'Unable to register user.',
      error: error.message
    });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        message: 'Email and password are required.'
      });
    }

    const user = await User.findOne({
      email: email.trim().toLowerCase()
    });

    if (!user) {
      return res.status(401).json({
        message: 'Invalid email or password.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        message: 'Invalid email or password.'
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: 'Server authentication configuration is missing.'
      });
    }

    const token = jwt.sign(
      { id: user._id.toString(), role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      message: 'Login successful!',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        vendorStatus: user.vendorStatus
      }
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Unable to log in.',
      error: error.message
    });
  }
});

// Get profile
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.status(200).json(user);
  } catch (error) {
    return res.status(500).json({
      message: 'Unable to fetch profile.',
      error: error.message
    });
  }
});

// Update profile
router.put('/profile', auth, async (req, res) => {
  try {
    const updates = {};

    if (typeof req.body.name === 'string') {
      if (!req.body.name.trim()) {
        return res.status(400).json({ message: 'Name cannot be empty.' });
      }
      updates.name = req.body.name.trim();
    }

    if (typeof req.body.email === 'string') {
      const email = req.body.email.trim().toLowerCase();

      if (!email) {
        return res.status(400).json({ message: 'Email cannot be empty.' });
      }

      const existingUser = await User.findOne({
        email,
        _id: { $ne: req.user.id }
      });

      if (existingUser) {
        return res.status(409).json({
          message: 'Email is already in use.'
        });
      }

      updates.email = email;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: 'Provide a name or email to update.'
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.status(200).json({
      message: 'Profile updated successfully!',
      user: updatedUser
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Unable to update profile.',
      error: error.message
    });
  }
});

module.exports = router;
