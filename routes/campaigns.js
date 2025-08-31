const express = require('express');
const router = express.Router();
const campaignsController = require('../controllers/campaigns.controller');
const campaignTemplatesController = require('../controllers/campaignTemplates.controller');
const { authenticate } = require('../middleware/auth.middleware');

// Public email tracking routes (no auth required)
router.get('/track/open/:trackingId', campaignsController.trackEmailOpen);
router.get('/track/click/:trackingId/:linkId', campaignsController.trackEmailClick);

// Apply authentication middleware to all other campaign routes
router.use(authenticate);

// Campaign CRUD operations
router.get('/', campaignsController.getCampaigns);
router.post('/', campaignsController.createCampaign);
router.get('/:id', campaignsController.getCampaignDetails);
router.put('/:id', campaignsController.updateCampaign);
router.delete('/:id', campaignsController.deleteCampaign);

// Campaign status management
router.put('/:id/status', campaignsController.updateCampaignStatus);

// Campaign launch
router.post('/:id/launch', campaignsController.launchCampaign);

// Campaign lead management
router.post('/:id/leads', campaignsController.addLeadsToCampaign);
router.delete('/:id/leads', campaignsController.removeLeadsFromCampaign);
router.post('/:id/leads/remove', campaignsController.removeLeadsFromCampaign);

// Dashboard analytics (organization-wide)
router.get('/dashboard/analytics', campaignsController.getDashboardAnalytics);

// Campaign analytics
router.get('/:id/analytics', campaignsController.getCampaignAnalytics);



// Campaign template management
router.get('/:campaignId/template', campaignTemplatesController.getCampaignTemplate);
router.post('/:campaignId/template', campaignTemplatesController.saveCampaignTemplate);
router.delete('/:campaignId/template', campaignTemplatesController.deleteCampaignTemplate);
router.post('/:campaignId/template/preview', campaignTemplatesController.previewTemplate);
router.get('/:campaignId/template/variables', campaignTemplatesController.getPersonalizationVariables);

module.exports = router;
