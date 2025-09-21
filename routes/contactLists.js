const express = require('express');
const router = express.Router();
const contactListsController = require('../controllers/contactLists.controller');
const { authenticate } = require('../middleware/auth.middleware');

// Apply authentication middleware to all routes
router.use(authenticate);

// Contact Lists Management
router.get('/', contactListsController.getContactLists);
router.post('/', contactListsController.createContactList);
router.post('/create-from-search', contactListsController.createFromSearch);

// Contact List Members
router.post('/:id/contacts', contactListsController.addContactsToList);
router.get('/:id/contacts', contactListsController.getListContacts);

// Import leads directly to a list
router.post('/:id/import', contactListsController.importLeadsToList);

// Smart lead filtering for campaigns (industry standard)
router.get('/available-leads', contactListsController.getAvailableLeads);

module.exports = router;
