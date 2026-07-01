const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  getDashboardSummary,
  getProjectAgents,
  getGeneratedArtifacts,
  getProjectTimeline,
} = require('../controllers/dashboardController');

const router = express.Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: Dashboard metrics and project overview
 */

/**
 * @swagger
 * /api/dashboard/summary:
 *   get:
 *     summary: Get dashboard KPI summary
 *     tags: [Dashboard]
 *     responses:
 *       200:
 *         description: Dashboard summary
 */
router.get('/summary', getDashboardSummary);

/**
 * @swagger
 * /api/dashboard/agents:
 *   get:
 *     summary: Get agent executions for a project
 *     tags: [Dashboard]
 *     parameters:
 *       - in: query
 *         name: project_id
 *         required: true
 *         schema: { type: string }
 */
router.get('/agents', getProjectAgents);

/**
 * @swagger
 * /api/dashboard/timeline:
 *   get:
 *     summary: Get project activity timeline
 *     tags: [Dashboard]
 *     parameters:
 *       - in: query
 *         name: project_id
 *         required: true
 *         schema: { type: string }
 */
router.get('/timeline', getProjectTimeline);

module.exports = router;
