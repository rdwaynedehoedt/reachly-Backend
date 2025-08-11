const express = require('express');
const router = express.Router();
const emailAuthController = require('../controllers/emailAuth.controller');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * OAuth routes for email account integration
 * All routes require user authentication
 */

/**
 * @route   GET /auth/google/connect
 * @desc    Initiate Google OAuth flow
 * @access  Private
 */
router.get('/google/connect', authenticate, (req, res) => emailAuthController.initiateGoogleAuth(req, res));

/**
 * @route   GET /auth/google/callback
 * @desc    Handle Google OAuth callback
 * @access  Public (but validates state parameter)
 */
router.get('/google/callback', (req, res) => emailAuthController.handleGoogleCallback(req, res));

/**
 * @route   GET /auth/email-accounts
 * @desc    Get user's connected email accounts
 * @access  Private
 */
router.get('/email-accounts', authenticate, (req, res) => emailAuthController.getEmailAccounts(req, res));

/**
 * @route   DELETE /auth/email-accounts/:accountId
 * @desc    Disconnect an email account
 * @access  Private
 */
router.delete('/email-accounts/:accountId', authenticate, (req, res) => emailAuthController.disconnectEmailAccount(req, res));

/**
 * @route   POST /auth/google/refresh
 * @desc    Refresh expired Google OAuth tokens
 * @access  Private
 */
router.post('/google/refresh', authenticate, async (req, res) => {
    try {
        const { accountId } = req.body;
        const userId = req.user.userId;
        
        // TODO: Implement token refresh logic
        // This will be handled by the Gmail service
        
        res.json({
            success: true,
            message: 'Token refresh endpoint - to be implemented'
        });
        
    } catch (error) {
        console.error('❌ Error refreshing tokens:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to refresh tokens',
            error: error.message
        });
    }
});

/**
 * Health check endpoint for email auth
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'Email auth service is running',
        timestamp: new Date().toISOString(),
        endpoints: {
            'GET /auth/google/connect': 'Initiate Google OAuth',
            'GET /auth/google/callback': 'Handle OAuth callback',
            'GET /auth/email-accounts': 'List connected accounts',
            'DELETE /auth/email-accounts/:id': 'Disconnect account',
            'POST /auth/google/refresh': 'Refresh tokens'
        }
    });
});

module.exports = router;
