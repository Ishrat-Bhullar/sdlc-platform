const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getProjectAgents,
  runAgent,
  runAllAgents,
  resumeProject,
  restartProject,
  getGeneratedFiles,
  getPipelineStatus,
} = require('../controllers/projectsController');

const router = express.Router();

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Projects
 *   description: Project management and agent pipeline
 */

/**
 * @swagger
 * /api/projects:
 *   get:
 *     summary: List all projects
 *     tags: [Projects]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, active, completed, archived, paused]
 *     responses:
 *       200:
 *         description: Projects array
 */
router.get('/', listProjects);

/**
 * @swagger
 * /api/projects:
 *   post:
 *     summary: Create project (Project Wizard contract)
 *     tags: [Projects]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:             { type: string }
 *               description:      { type: string }
 *               projectType:      { type: string }
 *               executionMode:    { type: string, enum: [auto, manual, hybrid] }
 *               buildType:        { type: string }
 *               deliverables:     { type: array, items: { type: string } }
 *               manualStages:     { type: array, items: { type: string } }
 *               providerSettings: { type: object }
 *               requirementsText: { type: string }
 *     responses:
 *       201:
 *         description: Created project with initialised agent pipeline
 */
router.post('/', createProject);

/**
 * @swagger
 * /api/projects/{id}:
 *   get:
 *     summary: Get single project with agents
 *     tags: [Projects]
 */
router.get('/:id', getProject);

/**
 * @swagger
 * /api/projects/{id}:
 *   put:
 *     summary: Update project metadata
 *     tags: [Projects]
 */
router.put('/:id', updateProject);

/**
 * @swagger
 * /api/projects/{id}:
 *   delete:
 *     summary: Delete project
 *     tags: [Projects]
 */
router.delete('/:id', deleteProject);

/**
 * @swagger
 * /api/projects/{id}/agents:
 *   get:
 *     summary: Get agent executions for a project
 *     tags: [Projects]
 */
router.get('/:id/agents', getProjectAgents);

/**
 * @swagger
 * /api/projects/{id}/agents/run-all:
 *   post:
 *     summary: Trigger full agent pipeline in sequence
 *     tags: [Projects]
 */
router.post('/:id/agents/run-all', runAllAgents);

/**
 * @swagger
 * /api/projects/{id}/agents/resume:
 *   post:
 *     summary: Resume the pipeline from the last failed checkpoint (does not re-run completed stages)
 *     tags: [Projects]
 */
router.post('/:id/agents/resume', resumeProject);

/**
 * @swagger
 * /api/projects/{id}/agents/restart:
 *   post:
 *     summary: Restart the pipeline from the first stage (Memory)
 *     tags: [Projects]
 */
router.post('/:id/agents/restart', restartProject);

/**
 * @swagger
 * /api/projects/{id}/agents/{executionId}/run:
 *   post:
 *     summary: Trigger a single agent
 *     tags: [Projects]
 */
router.post('/:id/agents/:executionId/run', runAgent);

/**
 * @swagger
 * /api/projects/{id}/files:
 *   get:
 *     summary: Get generated files for a project
 *     tags: [Projects]
 */
router.get('/:id/files', getGeneratedFiles);
router.get('/:id/pipeline-status', getPipelineStatus);

module.exports = router;
