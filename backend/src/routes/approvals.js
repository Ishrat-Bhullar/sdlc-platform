const express = require('express');
const { authenticate } = require('../middleware/auth');
const approvalsController = require('../controllers/approvalsController');

const router = express.Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Approvals
 *   description: Approval workflows and review management
 */

// CRUD
router.get('/approvals', approvalsController.listApprovals);
router.get('/approvals/:id', approvalsController.getApproval);

// Workflow actions
router.post('/approvals/approve', approvalsController.approveApproval);
router.post('/approvals/reject', approvalsController.rejectApproval);
router.post('/approvals/request-changes', approvalsController.requestChanges);

// Legacy workflow endpoints used by frontend ApprovalCenter
router.get('/workflow/all-approvals', approvalsController.listApprovals);
router.post('/workflow/resume', approvalsController.approveApproval);
router.post('/workflow/reject', approvalsController.rejectApproval);

// Alias endpoints when router is mounted at /api/workflow
router.get('/all-approvals', approvalsController.listApprovals);
router.post('/resume', approvalsController.approveApproval);
router.post('/reject', approvalsController.rejectApproval);

module.exports = router;