const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth.middleware');

// Route to update user profile including onboarding completion
router.put('/profile', authenticate, userController.updateProfile);

// Route to complete onboarding
router.post('/complete-onboarding', authenticate, userController.completeOnboarding);

module.exports = router;