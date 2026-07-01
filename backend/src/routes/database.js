const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Database
 *   description: Database schema and migration management
 */

// TODO: Implement database schema endpoints

module.exports = router;
