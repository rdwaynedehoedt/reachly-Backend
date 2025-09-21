const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analytics.controller');
const { authenticate } = require('../middleware/auth.middleware');

// Apply authentication middleware to all routes
router.use(authenticate);

/**
 * @route GET /api/analytics/global-contacts
 * @desc Get global contacts database analytics
 * @access Private
 */
router.get('/global-contacts', analyticsController.getGlobalContactsAnalytics);

/**
 * @route GET /api/analytics/organization-enrichment
 * @desc Get organization-specific enrichment statistics  
 * @access Private
 */
router.get('/organization-enrichment', analyticsController.getOrganizationEnrichmentStats);

/**
 * @route GET /api/analytics/credit-savings
 * @desc Get credit savings report showing global database benefits
 * @access Private
 */
router.get('/credit-savings', analyticsController.getCreditSavingsReport);

module.exports = router;
