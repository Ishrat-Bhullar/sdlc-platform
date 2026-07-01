const { query } = require('../config/database');

/**
 * Dashboard Summary - KPI overview
 */
const getDashboardSummary = async (req, res, next) => {
  try {
    // Temporary: Return mock data when database is not available
    try {
      const [projectsResult, agentsResult, approvalsResult, artifactsResult, docsResult] = await Promise.all([
        query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='active') as active, COUNT(*) FILTER (WHERE status='completed') as completed FROM projects"),
        query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='running') as running, COUNT(*) FILTER (WHERE status='completed') as completed, COUNT(*) FILTER (WHERE status='failed') as failed FROM agent_executions"),
        query("SELECT COUNT(*) as total FROM approvals WHERE status='pending'"),
        query("SELECT COUNT(*) as total FROM generated_artifacts"),
        query("SELECT COUNT(*) as total FROM documents"),
      ]);

      const summary = {
        total_projects: parseInt(projectsResult.rows[0]?.total || 0),
        active_projects: parseInt(projectsResult.rows[0]?.active || 0),
        completed_projects: parseInt(projectsResult.rows[0]?.completed || 0),
        total_agent_runs: parseInt(agentsResult.rows[0]?.total || 0),
        running_agents: parseInt(agentsResult.rows[0]?.running || 0),
        completed_agents: parseInt(agentsResult.rows[0]?.completed || 0),
        failed_agents: parseInt(agentsResult.rows[0]?.failed || 0),
        pending_approvals: parseInt(approvalsResult.rows[0]?.total || 0),
        total_artifacts: parseInt(artifactsResult.rows[0]?.total || 0),
        total_documents: parseInt(docsResult.rows[0]?.total || 0),
      };

      res.json(summary);
    } catch (dbError) {
      // Database not available, return mock data
      const summary = {
        total_projects: 0,
        active_projects: 0,
        completed_projects: 0,
        total_agent_runs: 0,
        running_agents: 0,
        completed_agents: 0,
        failed_agents: 0,
        pending_approvals: 0,
        total_artifacts: 0,
        total_documents: 0,
      };
      res.json(summary);
    }
  } catch (err) {
    next(err);
  }
};

/**
 * Get agent executions for a specific project
 */
const getProjectAgents = async (req, res, next) => {
  try {
    const { project_id } = req.query;
    if (!project_id) {
      return res.status(400).json({ error: 'ValidationError', message: 'project_id is required' });
    }

    try {
      const result = await query(
        `SELECT 
          id,
          project_id,
          agent_name,
          agent_type,
          status,
          progress,
          runtime_seconds,
          tokens_used,
          cost_usd,
          current_task,
          error_message,
          started_at as start_time,
          completed_at as end_time,
          output_data as output_url,
          created_at,
          updated_at
         FROM agent_executions 
         WHERE project_id = $1 
         ORDER BY execution_order ASC`,
        [project_id]
      );

      res.json(result.rows);
    } catch (dbError) {
      // Database not available, return empty array
      res.json([]);
    }
  } catch (err) {
    next(err);
  }
};

/**
 * Get generated artifacts for a specific project
 */
const getGeneratedArtifacts = async (req, res, next) => {
  try {
    const { project_id } = req.query;
    if (!project_id) {
      return res.status(400).json({ error: 'ValidationError', message: 'project_id is required' });
    }

    try {
      const result = await query(
        `SELECT 
          id,
          project_id,
          agent_execution_id,
          artifact_type,
          content,
          metadata,
          version,
          created_at,
          updated_at
         FROM generated_artifacts 
         WHERE project_id = $1 
         ORDER BY created_at DESC`,
        [project_id]
      );

      res.json(result.rows);
    } catch (dbError) {
      // Database not available, return empty array
      res.json([]);
    }
  } catch (err) {
    next(err);
  }
};

/**
 * Get project activity timeline
 */
const getProjectTimeline = async (req, res, next) => {
  try {
    const { project_id } = req.query;
    if (!project_id) {
      return res.status(400).json({ error: 'ValidationError', message: 'project_id is required' });
    }

    const result = await query(
      `SELECT 
        id,
        project_id,
        agent_name,
        agent_type,
        stage,
        action,
        result,
        output_data,
        tokens_used,
        duration_ms,
        created_at
       FROM temporal_events 
       WHERE project_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [project_id]
    );

    res.json({ events: result.rows });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDashboardSummary,
  getProjectAgents,
  getGeneratedArtifacts,
  getProjectTimeline,
};
