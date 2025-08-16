const express = require('express');
const router = express.Router();
const campaignsController = require('../controllers/campaigns.controller.v2');
const { authenticate } = require('../middleware/auth.middleware');

// Apply auth middleware to all routes
router.use(authenticate);

// Campaign CRUD operations
router.get('/', campaignsController.getCampaigns);
router.post('/', campaignsController.createCampaign);
router.get('/:id', campaignsController.getCampaignDetails);
router.put('/:id/status', campaignsController.updateCampaignStatus);

// Sequence management
router.post('/:id/sequences', campaignsController.addSequenceStep);

// Lead management
router.post('/:id/leads', campaignsController.addLeadsToCampaign);

// Analytics
router.get('/:id/analytics', campaignsController.getCampaignAnalytics);

module.exports = router;
