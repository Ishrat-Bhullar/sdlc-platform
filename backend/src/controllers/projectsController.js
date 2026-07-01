const { query } = require('../config/database');
const agentOrchestrator = require('../services/agentOrchestrator');
const { broadcast } = require('../websocket/progressSocket');

// ── helpers ───────────────────────────────────────────────────────────────────
const toFrontendProject = (row, agents = []) => ({
  id: String(row.id),
  name: row.name,
  description: row.description || '',
  status: row.status,
  progress: row.progress || 0,
  projectType: row.project_type,
  executionMode: row.execution_mode,
  buildType: row.build_type,
  requirementsText: row.requirements_text || '',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  agents,
});

const toFrontendAgent = (row) => ({
  id: String(row.id),
  name: row.agent_name,
  type: row.agent_type,
  status: row.status,
  currentTask: row.current_task || null,
  progress: row.progress || 0,
  runtime: row.runtime_seconds || 0,
  tokens: row.tokens_used || 0,
  cost: parseFloat(row.cost_usd) || 0,
  lastActivity: row.updated_at,
});

const getAgentsForProject = async (projectId) => {
  const result = await query(
    'SELECT * FROM agent_executions WHERE project_id = $1 ORDER BY execution_order',
    [projectId]
  );
  return result.rows.map(toFrontendAgent);
};

// ── List projects ─────────────────────────────────────────────────────────────
const listProjects = async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    
    try {
      let sql = 'SELECT * FROM projects';
      const params = [];
      if (status) {
        params.push(status);
        sql += ` WHERE status = $${params.length}`;
      }
      sql += ' ORDER BY updated_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(limit, offset);

      const result = await query(sql, params);
      const projects = await Promise.all(
        result.rows.map(async (row) => {
          const agents = await getAgentsForProject(row.id);
          return toFrontendProject(row, agents);
        })
      );
      res.json({ projects, total: projects.length });
    } catch (dbError) {
      // Database not available, return empty projects list
      res.json({ projects: [], total: 0 });
    }
  } catch (err) {
    next(err);
  }
};

// ── Get single project ────────────────────────────────────────────────────────
const getProject = async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'NotFound', message: 'Project not found' });
    const agents = await getAgentsForProject(req.params.id);
    res.json(toFrontendProject(result.rows[0], agents));
  } catch (err) {
    next(err);
  }
};

// ── Create project (NewProjectWizard contract) ────────────────────────────────
const createProject = async (req, res, next) => {
  try {
    const {
      name,
      description = '',
      projectType = 'web-app',
      executionMode = 'auto',
      buildType = 'private-enterprise',
      deliverables = [],
      manualStages = [],
      providerSettings = {},
      requirementsText = '',
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'ValidationError', message: 'Project name is required' });
    }

    const result = await query(
      `INSERT INTO projects
         (name, description, project_type, execution_mode, build_type,
          status, progress, deliverables, manual_stages, provider_settings, requirements_text)
       VALUES ($1,$2,$3,$4,$5,'draft',0,$6,$7,$8,$9)
       RETURNING *`,
      [
        name.trim(),
        description,
        projectType,
        executionMode,
        buildType,
        JSON.stringify(deliverables),
        JSON.stringify(manualStages),
        JSON.stringify(providerSettings),
        requirementsText,
      ]
    );

    const project = result.rows[0];

    // Initialise agent pipeline
    const selectedAgents = executionMode === 'manual' ? deliverables : undefined;
    await agentOrchestrator.initializeProjectAgents(project.id, executionMode, selectedAgents);

    // Set project to active
    await query("UPDATE projects SET status = 'active', updated_at = NOW() WHERE id = $1", [project.id]);
    project.status = 'active';

    const agents = await getAgentsForProject(project.id);
    const front = toFrontendProject(project, agents);

    broadcast(project.id, { event: 'project_created', payload: front });

    res.status(201).json(front);
  } catch (err) {
    next(err);
  }
};

// ── Update project ────────────────────────────────────────────────────────────
const updateProject = async (req, res, next) => {
  try {
    const { name, description, status, requirementsText } = req.body;
    const result = await query(
      `UPDATE projects SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         status = COALESCE($3, status),
         requirements_text = COALESCE($4, requirements_text),
         updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [name, description, status, requirementsText, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'NotFound', message: 'Project not found' });
    const agents = await getAgentsForProject(req.params.id);
    res.json(toFrontendProject(result.rows[0], agents));
  } catch (err) {
    next(err);
  }
};

// ── Delete project ────────────────────────────────────────────────────────────
const deleteProject = async (req, res, next) => {
  try {
    const result = await query('DELETE FROM projects WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'NotFound', message: 'Project not found' });
    res.json({ message: 'Project deleted', id: req.params.id });
  } catch (err) {
    next(err);
  }
};

// ── Get project agents ────────────────────────────────────────────────────────
const getProjectAgents = async (req, res, next) => {
  try {
    const agents = await getAgentsForProject(req.params.id);
    res.json({ agents });
  } catch (err) {
    next(err);
  }
};

// ── Trigger single agent run ──────────────────────────────────────────────────
const runAgent = async (req, res, next) => {
  try {
    const { executionId } = req.params;
    const projectId = req.params.id;

    const exec = await query('SELECT * FROM agent_executions WHERE id = $1 AND project_id = $2', [executionId, projectId]);
    if (!exec.rows.length) return res.status(404).json({ error: 'NotFound', message: 'Agent execution not found' });
    if (exec.rows[0].status === 'running') {
      return res.status(409).json({ error: 'Conflict', message: 'Agent already running' });
    }

    // Fire and forget — WebSocket pushes progress
    agentOrchestrator.runAgent(executionId, projectId, req.user?.id).catch((err) => {
      console.error(`[agent] ${executionId} failed:`, err.message);
    });

    res.json({ message: 'Agent started', executionId });
  } catch (err) {
    next(err);
  }
};

// ── Run all agents in sequence ────────────────────────────────────────────────
const runAllAgents = async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const proj = await query('SELECT id, execution_mode, deliverables FROM projects WHERE id = $1', [projectId]);
    if (!proj.rows.length) return res.status(404).json({ error: 'NotFound', message: 'Project not found' });

    const project = proj.rows[0];
    await agentOrchestrator.initializeProjectAgents(
      projectId,
      project.execution_mode || 'auto',
      project.execution_mode === 'manual' ? project.deliverables : undefined
    );

    (async () => {
      try {
        await agentOrchestrator.runPipeline(projectId, req.user?.id);
      } catch (err) {
        console.error(`[pipeline] project ${projectId} failed:`, err.message);
      }
    })();

    res.json({ message: 'Pipeline started' });
  } catch (err) {
    next(err);
  }
};

// ── Get generated files for a project ────────────────────────────────────────
const getPipelineStatus = async (req, res, next) => {
  try {
    const projectId = req.params.id;

    const projectResult = await query('SELECT id FROM projects WHERE id = $1', [projectId]);
    if (!projectResult.rows.length) {
      return res.status(404).json({ error: 'NotFound', message: 'Project not found' });
    }

    const result = await query(
      `SELECT id, agent_type, agent_name, status, execution_order
       FROM agent_executions
       WHERE project_id = $1
       ORDER BY execution_order ASC, id ASC`,
      [projectId]
    );

    const rows = result.rows || [];
    const total = rows.length;

    const toStageKey = (agentType) => {
      if (agentType === 'business-analyst') return 'business_analyst';
      if (agentType === 'ui-ux') return 'ui_ux';
      if (agentType === 'presentation-video') return 'presentation_video_agent';
      if (agentType === 'human-review-1') return 'human_review_1';
      if (agentType === 'human-review-2') return 'human_review_2';
      return String(agentType || '').replace(/-/g, '_');
    };

    const toStageLabel = (agentName) => agentName || 'Unknown Stage';

    const normalizeStatus = (status) => {
      if (status === 'completed') return 'completed';
      if (status === 'running') return 'running';
      if (status === 'failed') return 'failed';
      if (status === 'waiting_approval' || status === 'waiting') return 'waiting_approval';
      return 'queued';
    };

    const stages = rows.map((r) => ({
      key: toStageKey(r.agent_type),
      label: toStageLabel(r.agent_name),
      status: normalizeStatus(r.status),
    }));

    const completed = stages.filter((s) => s.status === 'completed').length;
    const currentStage = stages.find((s) => s.status === 'running' || s.status === 'waiting_approval') || null;
    const hasFailed = stages.some((s) => s.status === 'failed');
    const hasWaitingApproval = stages.some((s) => s.status === 'waiting_approval');
    const hasRunning = stages.some((s) => s.status === 'running');

    let workflow_status = 'idle';
    if (hasFailed) workflow_status = 'failed';
    else if (completed === total && total > 0) workflow_status = 'completed';
    else if (hasWaitingApproval) workflow_status = 'waiting_approval';
    else if (hasRunning || completed > 0) workflow_status = 'running';

    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return res.json({
      completed_stages: completed,
      current_stage: currentStage ? currentStage.label : null,
      current_agent: currentStage ? currentStage.label : null,
      total_stages: total,
      percentage,
      workflow_status,
      stages,
    });
  } catch (err) {
    next(err);
  }
};

const getGeneratedFiles = async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM generated_files WHERE project_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    const files = result.rows.map((row) => ({
      id: String(row.id),
      path: row.file_path,
      name: row.file_name,
      content: row.content || '',
      lines: row.lines_of_code || 0,
      language: row.language || 'typescript',
      fileType: row.file_type,
      generatedAt: row.created_at,
      generator: row.file_type === 'frontend' ? 'Frontend Agent' : 'Backend Agent',
    }));
    res.json({ files });
  } catch (err) {
    next(err);
  }
};


module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getProjectAgents,
  runAgent,
  runAllAgents,
  getGeneratedFiles,
  getPipelineStatus,
};
