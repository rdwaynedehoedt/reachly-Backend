const express = require('express');
const router = express.Router();
const leadsController = require('../controllers/leads.controller');
const { authenticate } = require('../middleware/auth.middleware');

// Apply authentication middleware to all leads routes
router.use(authenticate);

/**
 * Leads management routes
 */

// Get all leads
router.get('/', leadsController.getLeads);

// Add a single lead
router.post('/', leadsController.addLead);

// Import leads from CSV
router.post('/import', leadsController.importLeads);

// Get lead statistics
router.get('/stats', leadsController.getLeadStats);

module.exports = router;
