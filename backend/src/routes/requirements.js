const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  listRequirements,
  getRequirement,
  createRequirement,
  updateRequirement,
  deleteRequirement,
  generateRequirements,
  listEpics,
  listUserStories,
  updateUserStory,
  generateUserStories,
  getRisksAndDeps,
} = require('../controllers/requirementsController');

const router = express.Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Requirements
 *   description: Requirements, epics and user stories
 */

/**
 * @swagger
 * /api/requirements:
 *   get:
 *     summary: List requirements (functional + non-functional) with counts
 *     tags: [Requirements]
 *     parameters:
 *       - in: query
 *         name: projectId
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string, enum: [Functional, Non-Functional] }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 */
router.get('/', listRequirements);

/**
 * @swagger
 * /api/requirements/generate:
 *   post:
 *     summary: AI-generate requirements from a prompt or requirements text
 *     tags: [Requirements]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [projectId]
 *             properties:
 *               projectId:        { type: string }
 *               prompt:           { type: string }
 *               requirementsText: { type: string }
 */
router.post('/generate', generateRequirements);

/**
 * @swagger
 * /api/requirements/generate-stories:
 *   post:
 *     summary: AI-generate epics and user stories from existing requirements
 *     tags: [Requirements]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [projectId]
 *             properties:
 *               projectId: { type: string }
 */
router.post('/generate-stories', generateUserStories);

/**
 * @swagger
 * /api/requirements/risks:
 *   get:
 *     summary: Get risks, dependencies and assumptions for a project
 *     tags: [Requirements]
 *     parameters:
 *       - in: query
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 */
router.get('/risks', getRisksAndDeps);

/**
 * @swagger
 * /api/requirements/epics:
 *   get:
 *     summary: List epics
 *     tags: [Requirements]
 *     parameters:
 *       - in: query
 *         name: projectId
 *         schema: { type: string }
 */
router.get('/epics', listEpics);

/**
 * @swagger
 * /api/requirements/stories:
 *   get:
 *     summary: List user stories
 *     tags: [Requirements]
 *     parameters:
 *       - in: query
 *         name: projectId
 *         schema: { type: string }
 *       - in: query
 *         name: epicId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 */
router.get('/stories', listUserStories);

/**
 * @swagger
 * /api/requirements/stories/{id}:
 *   put:
 *     summary: Update a user story
 *     tags: [Requirements]
 */
router.put('/stories/:id', updateUserStory);

/**
 * @swagger
 * /api/requirements/{id}:
 *   get:
 *     summary: Get single requirement
 *     tags: [Requirements]
 */
router.get('/:id', getRequirement);

/**
 * @swagger
 * /api/requirements:
 *   post:
 *     summary: Manually create a requirement
 *     tags: [Requirements]
 */
router.post('/', createRequirement);

/**
 * @swagger
 * /api/requirements/{id}:
 *   put:
 *     summary: Update requirement
 *     tags: [Requirements]
 */
router.put('/:id', updateRequirement);

/**
 * @swagger
 * /api/requirements/{id}:
 *   delete:
 *     summary: Delete requirement
 *     tags: [Requirements]
 */
router.delete('/:id', deleteRequirement);

module.exports = router;