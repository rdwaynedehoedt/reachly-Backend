const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

// Input validation middleware
const validateSignup = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 1 })
    .withMessage('First name cannot be empty'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Last name cannot be empty')
];

const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

// Validation error handler
const handleValidationErrors = (req, res, next) => {
  const { validationResult } = require('express-validator');
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  
  next();
};

// Public routes
router.post('/signup', validateSignup, handleValidationErrors, authController.signup);
router.post('/login', validateLogin, handleValidationErrors, authController.login);
router.post('/logout', authController.logout);
router.post('/refresh-token', authController.refreshToken);

// Google OAuth callback route (for authorization code flow)
router.get('/google/callback', authController.googleCallback);

// Protected routes
router.get('/me', authenticate, authController.getCurrentUser);

module.exports = router;