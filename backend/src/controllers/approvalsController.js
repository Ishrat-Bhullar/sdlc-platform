const { query } = require('../config/database');
const agentOrchestrator = require('../services/agentOrchestrator');
const { emitApprovalCompleted } = require('../websocket/progressSocket');

const listApprovals = async (req, res, next) => {
  try {
    const { projectId, status } = req.query;
    const params = [];
    let sql = 'SELECT * FROM approvals WHERE 1=1';
    if (projectId) { params.push(projectId); sql += ` AND project_id = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
    sql += ' ORDER BY created_at DESC';
    const result = await query(sql, params);
    res.json({ approvals: result.rows });
  } catch (err) {
    next(err);
  }
};

const getApproval = async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM approvals WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'NotFound', message: 'Approval not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

const approveApproval = async (req, res, next) => {
  try {
    const { projectId, approvedBy, comment } = req.body;
    if (!projectId) return res.status(400).json({ error: 'ValidationError', message: 'projectId is required' });
    
    // Find the pending approval for this project
    const result = await query(
      'SELECT * FROM approvals WHERE project_id = $1 AND status = $2 ORDER BY created_at ASC LIMIT 1',
      [projectId, 'pending']
    );
    
    if (!result.rows.length) {
      return res.status(404).json({ error: 'NotFound', message: 'No pending approval found for this project' });
    }
    
    const approval = result.rows[0];
    const updated = await query(
      `UPDATE approvals SET status = $1, approved_by = $2, comment = $3, decided_at = NOW() WHERE id = $4 RETURNING *`,
      ['approved', approvedBy || null, comment || null, approval.id]
    );

    emitApprovalCompleted(projectId, approval.id, 'approved', approvedBy || null);

    (async () => {
      try {
        await agentOrchestrator.resumePipelineAfterApproval(projectId, req.user?.id || null);
      } catch (resumeErr) {
        console.error(`[approval] pipeline resume failed for project ${projectId}:`, resumeErr.message);
      }
    })();
    
    res.json(updated.rows[0]);
  } catch (err) {
    next(err);
  }
};

const rejectApproval = async (req, res, next) => {
  try {
    const { projectId, reason, rejectedBy } = req.body;
    if (!projectId) return res.status(400).json({ error: 'ValidationError', message: 'projectId is required' });
    
    const result = await query(
      'SELECT * FROM approvals WHERE project_id = $1 AND status = $2 ORDER BY created_at ASC LIMIT 1',
      [projectId, 'pending']
    );
    
    if (!result.rows.length) {
      return res.status(404).json({ error: 'NotFound', message: 'No pending approval found for this project' });
    }
    
    const approval = result.rows[0];
    const updated = await query(
      `UPDATE approvals SET status = $1, approved_by = $2, comment = $3, decided_at = NOW() WHERE id = $4 RETURNING *`,
      ['rejected', rejectedBy || null, reason || null, approval.id]
    );

    emitApprovalCompleted(projectId, approval.id, 'rejected', rejectedBy || null);
    
    res.json(updated.rows[0]);
  } catch (err) {
    next(err);
  }
};

const requestChanges = async (req, res, next) => {
  try {
    const { projectId, comment, requestedBy } = req.body;
    if (!projectId) return res.status(400).json({ error: 'ValidationError', message: 'projectId is required' });
    
    const result = await query(
      'SELECT * FROM approvals WHERE project_id = $1 AND status = $2 ORDER BY created_at ASC LIMIT 1',
      [projectId, 'pending']
    );
    
    if (!result.rows.length) {
      return res.status(404).json({ error: 'NotFound', message: 'No pending approval found for this project' });
    }
    
    const approval = result.rows[0];
    const updated = await query(
      `UPDATE approvals SET status = $1, approved_by = $2, comment = $3, decided_at = NOW() WHERE id = $4 RETURNING *`,
      ['changes_requested', requestedBy || null, comment || null, approval.id]
    );

    emitApprovalCompleted(projectId, approval.id, 'changes_requested', requestedBy || null);
    
    res.json(updated.rows[0]);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listApprovals,
  getApproval,
  approveApproval,
  rejectApproval,
  requestChanges,
};