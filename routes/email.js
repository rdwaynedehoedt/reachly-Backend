const express = require('express');
const router = express.Router();
const emailController = require('../controllers/email.controller');
const { authenticate } = require('../middleware/auth.middleware');

// Apply authentication middleware to all email routes
router.use(authenticate);

/**
 * Email sending routes
 */

// Send a single email
router.post('/send', emailController.sendEmail);

// Get user's email accounts for sending
router.get('/accounts', emailController.getEmailAccounts);

// Test email account connection
router.post('/test-connection', emailController.testConnection);

// Get email sending history
router.get('/history', emailController.getEmailHistory);

module.exports = router;
