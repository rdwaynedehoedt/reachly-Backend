const express = require('express');
const { googleAuth, microsoftAuth } = require('../controllers/oauth.controller');

const router = express.Router();

// Google OAuth route
router.post('/google', googleAuth);

// Microsoft OAuth route
router.post('/microsoft', microsoftAuth);

module.exports = router;