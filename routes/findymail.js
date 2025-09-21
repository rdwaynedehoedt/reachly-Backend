/**
 * FindyMail API Routes
 * All FindyMail integration endpoints
 */

const express = require('express');
const router = express.Router();
const findymailController = require('../controllers/findymail.controller');
const { authenticate } = require('../middleware/auth.middleware');

// Apply auth middleware to all routes (required for multi-org support)
router.use(authenticate);

/**
 * @route   POST /api/findymail/find-email-linkedin
 * @desc    Find email from LinkedIn URL
 * @access  Private (requires authentication)
 * @body    { linkedin_url: string, lead_id?: string }
 * @returns { success: boolean, data: object, credits_used: number }
 */
router.post('/find-email-linkedin', findymailController.findEmailFromLinkedIn);

/**
 * @route   POST /api/findymail/verify-email
 * @desc    Verify an email address
 * @access  Private
 * @body    { email: string }
 * @returns { success: boolean, data: object, credits_used: number }
 */
router.post('/verify-email', findymailController.verifyEmail);

/**
 * @route   POST /api/findymail/bulk-find-emails
 * @desc    Find emails for multiple LinkedIn URLs
 * @access  Private
 * @body    { linkedin_urls: [{ linkedin_url: string, lead_id?: string }] }
 * @returns { success: boolean, summary: object, results: array }
 */
router.post('/bulk-find-emails', findymailController.bulkFindEmails);

/**
 * @route   GET /api/findymail/credits
 * @desc    Get remaining FindyMail credits
 * @access  Private
 * @returns { success: boolean, data: { finderCredits: number, verifierCredits: number } }
 */
router.get('/credits', findymailController.getCredits);

/**
 * @route   GET /api/findymail/stats
 * @desc    Get organization enrichment statistics
 * @access  Private
 * @returns { success: boolean, data: object }
 */
router.get('/stats', findymailController.getOrganizationStats);

/**
 * @route   GET /api/findymail/lead/:leadId/history
 * @desc    Get enrichment history for a specific lead
 * @access  Private
 * @param   leadId - UUID of the lead
 * @returns { success: boolean, data: array }
 */
router.get('/lead/:leadId/history', findymailController.getLeadEnrichmentHistory);

module.exports = router;
