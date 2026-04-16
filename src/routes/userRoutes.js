const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middlewares/authMiddleware');
const userProfileController = require('../controllers/userProfileController');

router.get('/profile', requireAuth, userProfileController.getProfile);
router.put('/profile', requireAuth, userProfileController.updateProfile);

module.exports = router;
