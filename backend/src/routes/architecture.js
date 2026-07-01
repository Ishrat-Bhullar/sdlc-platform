const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Architecture
 *   description: Architecture proposals and diagrams
 */

// TODO: Implement architecture endpoints

module.exports = router;
