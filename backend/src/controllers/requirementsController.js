const { query } = require('../config/database');
const aiService = require('../services/aiService');
const { emitArtifactGenerated, emitApprovalRequested } = require('../websocket/progressSocket');

// ── helpers ───────────────────────────────────────────────────────────────────
const toReq = (row) => ({
  id:          String(row.id),
  reqId:       row.req_id || `REQ-${row.id}`,
  description: row.description,
  category:    row.category || 'Functional',
  priority:    row.priority || 'medium',
  riskLevel:   row.risk_level || 'low',
  status:      row.status || 'pending',
  source:      row.source || 'ai-generated',
  createdAt:   row.created_at,
  updatedAt:   row.updated_at,
});

const toStory = (row) => ({
  id:                 String(row.id),
  storyId:            row.story_id || `US-${row.id}`,
  title:              row.title,
  description:        row.description || '',
  acceptanceCriteria: row.acceptance_criteria || [],
  priority:           row.priority || 'should',
  moscowPriority:     row.moscow_priority || 'Should',
  status:             row.status || 'todo',
  points:             row.points || 0,
  epic:               row.epic_title || '',
  epicId:             row.epic_id ? String(row.epic_id) : null,
  createdAt:          row.created_at,
});

const toEpic = (row) => ({
  id:          String(row.id),
  title:       row.title,
  description: row.description || '',
  priority:    row.priority || 'should',
  status:      row.status || 'todo',
  createdAt:   row.created_at,
});

// ── Requirements CRUD ─────────────────────────────────────────────────────────
const listRequirements = async (req, res, next) => {
  try {
    const { projectId, category, status } = req.query;
    const params = [];
    let sql = 'SELECT * FROM requirements WHERE 1=1';

    if (projectId) { params.push(projectId); sql += ` AND project_id = $${params.length}`; }
    if (category)  { params.push(category);  sql += ` AND category = $${params.length}`; }
    if (status)    { params.push(status);     sql += ` AND status = $${params.length}`; }

    sql += ' ORDER BY req_id ASC NULLS LAST, id ASC';

    const result = await query(sql, params);
    const rows = result.rows;

    res.json({
      requirements: rows.filter((r) => r.category !== 'Non-Functional').map(toReq),
      nonFunctional: rows.filter((r) => r.category === 'Non-Functional').map(toReq),
      counts: {
        total:        rows.length,
        functional:   rows.filter((r) => r.category === 'Functional').length,
        nonFunctional: rows.filter((r) => r.category === 'Non-Functional').length,
        approved:     rows.filter((r) => r.status === 'approved').length,
        reviewing:    rows.filter((r) => r.status === 'reviewing').length,
        pending:      rows.filter((r) => r.status === 'pending').length,
      },
    });
  } catch (err) {
    next(err);
  }
};

const getRequirement = async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM requirements WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'NotFound', message: 'Requirement not found' });
    res.json(toReq(result.rows[0]));
  } catch (err) {
    next(err);
  }
};

const createRequirement = async (req, res, next) => {
  try {
    const { projectId, reqId, description, category = 'Functional', priority = 'medium', riskLevel = 'low', source = 'manual' } = req.body;
    if (!projectId || !description) {
      return res.status(400).json({ error: 'ValidationError', message: 'projectId and description are required' });
    }
    const result = await query(
      `INSERT INTO requirements (project_id, req_id, description, category, priority, risk_level, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [projectId, reqId, description, category, priority, riskLevel, source]
    );
    res.status(201).json(toReq(result.rows[0]));
  } catch (err) {
    next(err);
  }
};

const updateRequirement = async (req, res, next) => {
  try {
    const { description, category, priority, riskLevel, status } = req.body;
    const result = await query(
      `UPDATE requirements SET
         description = COALESCE($1, description),
         category    = COALESCE($2, category),
         priority    = COALESCE($3, priority),
         risk_level  = COALESCE($4, risk_level),
         status      = COALESCE($5, status),
         updated_at  = NOW()
       WHERE id = $6 RETURNING *`,
      [description, category, priority, riskLevel, status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'NotFound', message: 'Requirement not found' });
    res.json(toReq(result.rows[0]));
  } catch (err) {
    next(err);
  }
};

const deleteRequirement = async (req, res, next) => {
  try {
    const result = await query('DELETE FROM requirements WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'NotFound', message: 'Requirement not found' });
    res.json({ message: 'Deleted', id: req.params.id });
  } catch (err) {
    next(err);
  }
};

// ── AI Generate requirements from prompt / docs ───────────────────────────────
const generateRequirements = async (req, res, next) => {
  try {
    const { projectId, prompt, requirementsText } = req.body;
    if (!projectId) return res.status(400).json({ error: 'ValidationError', message: 'projectId is required' });

    const inputText = prompt || requirementsText || '';
    const aiResult = await aiService.complete(
      `Extract and structure software requirements from the following input. Return JSON only with keys:
       functional (array of {id,description,category,priority,risk_level}),
       nonFunctional (array of same shape with category set to "Non-Functional"),
       risks (array of strings),
       dependencies (array of strings),
       assumptions (array of strings).
       Input: ${inputText}`,
      {
        systemPrompt: 'You are an expert business analyst. Extract structured requirements. Return valid JSON only.',
        userId: req.user?.id,
      }
    );

    let parsed;
    try { parsed = JSON.parse(aiResult.text); } catch { parsed = { functional: [], nonFunctional: [], risks: [], dependencies: [], assumptions: [] }; }

    // Persist to DB
    const allReqs = [
      ...(parsed.functional || []),
      ...(parsed.nonFunctional || []).map((r) => ({ ...r, category: 'Non-Functional' })),
    ];

    const inserted = [];
    let counter = 1;
    for (const req_ of allReqs) {
      const autoId = req_.id || `${req_.category === 'Non-Functional' ? 'NFR' : 'FR'}-${String(counter++).padStart(3, '0')}`;
      const r = await query(
        `INSERT INTO requirements (project_id, req_id, description, category, priority, risk_level, source)
         VALUES ($1,$2,$3,$4,$5,$6,'ai-generated') RETURNING *`,
        [projectId, autoId, req_.description, req_.category || 'Functional', req_.priority || 'medium', req_.risk_level || 'low']
      );
      inserted.push(toReq(r.rows[0]));
    }

    // Update project requirements_text
    await query('UPDATE projects SET requirements_text = $1, updated_at = NOW() WHERE id = $2', [inputText, projectId]);

    emitArtifactGenerated(projectId, 'requirements', `Generated ${inserted.length} requirements`);

    res.json({
      requirements:  inserted.filter((r) => r.category !== 'Non-Functional'),
      nonFunctional: inserted.filter((r) => r.category === 'Non-Functional'),
      risks:         parsed.risks || [],
      dependencies:  parsed.dependencies || [],
      assumptions:   parsed.assumptions || [],
      counts: { total: inserted.length },
    });
  } catch (err) {
    next(err);
  }
};

// ── Epics ─────────────────────────────────────────────────────────────────────
const listEpics = async (req, res, next) => {
  try {
    const { projectId } = req.query;
    const params = [];
    let sql = 'SELECT * FROM epics WHERE 1=1';
    if (projectId) { params.push(projectId); sql += ` AND project_id = $${params.length}`; }
    sql += ' ORDER BY id ASC';
    const result = await query(sql, params);
    res.json({ epics: result.rows.map(toEpic) });
  } catch (err) {
    next(err);
  }
};

// ── User Stories ──────────────────────────────────────────────────────────────
const listUserStories = async (req, res, next) => {
  try {
    const { projectId, epicId, status } = req.query;
    const params = [];
    let sql = `SELECT us.*, e.title AS epic_title
               FROM user_stories us
               LEFT JOIN epics e ON e.id = us.epic_id
               WHERE 1=1`;

    if (projectId) { params.push(projectId); sql += ` AND us.project_id = $${params.length}`; }
    if (epicId)    { params.push(epicId);    sql += ` AND us.epic_id = $${params.length}`; }
    if (status)    { params.push(status);    sql += ` AND us.status = $${params.length}`; }

    sql += ' ORDER BY us.id ASC';

    const result = await query(sql, params);
    res.json({ userStories: result.rows.map(toStory), total: result.rows.length });
  } catch (err) {
    next(err);
  }
};

const updateUserStory = async (req, res, next) => {
  try {
    const { title, description, acceptanceCriteria, priority, moscowPriority, status, points } = req.body;
    const result = await query(
      `UPDATE user_stories SET
         title              = COALESCE($1, title),
         description        = COALESCE($2, description),
         acceptance_criteria = COALESCE($3, acceptance_criteria),
         priority           = COALESCE($4, priority),
         moscow_priority    = COALESCE($5, moscow_priority),
         status             = COALESCE($6, status),
         points             = COALESCE($7, points)
       WHERE id = $8 RETURNING *`,
      [title, description, JSON.stringify(acceptanceCriteria), priority, moscowPriority, status, points, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'NotFound', message: 'User story not found' });
    res.json(toStory(result.rows[0]));
  } catch (err) {
    next(err);
  }
};

// ── AI Generate epics + user stories from existing requirements ───────────────
const generateUserStories = async (req, res, next) => {
  try {
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ error: 'ValidationError', message: 'projectId is required' });

    // Fetch existing requirements for context
    const reqResult = await query(
      "SELECT description, category FROM requirements WHERE project_id = $1 ORDER BY id",
      [projectId]
    );
    const reqText = reqResult.rows.map((r) => `[${r.category}] ${r.description}`).join('\n');

    const aiResult = await aiService.complete(
      `Based on these requirements, generate epics and user stories. Return JSON with:
       epics (array of {title, description}),
       stories (array of {epic, title, description, acceptanceCriteria (array of strings), priority (critical/high/medium/low), moscowPriority (Must/Should/Could/Won't), points}).
       Requirements:\n${reqText || 'General software project'}`,
      {
        systemPrompt: 'You are an expert agile business analyst. Generate proper Scrum artefacts. Return valid JSON only.',
        userId: req.user?.id,
      }
    );

    let parsed;
    try { parsed = JSON.parse(aiResult.text); } catch { parsed = { epics: [], stories: [] }; }

    // Persist epics
    const epicMap = {};
    for (const ep of (parsed.epics || [])) {
      const r = await query(
        'INSERT INTO epics (project_id, title, description) VALUES ($1,$2,$3) RETURNING id, title',
        [projectId, ep.title, ep.description || '']
      );
      epicMap[ep.title] = r.rows[0].id;
    }

    // Persist stories
    const insertedStories = [];
    let stIdx = 1;
    for (const story of (parsed.stories || [])) {
      const epicId = epicMap[story.epic] || null;
      const storyId = `US-${String(stIdx++).padStart(3, '0')}`;
      const r = await query(
        `INSERT INTO user_stories
           (project_id, epic_id, story_id, title, description, acceptance_criteria, priority, moscow_priority, points)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          projectId, epicId, storyId, story.title,
          story.description || '',
          JSON.stringify(story.acceptanceCriteria || []),
          story.priority || 'medium',
          story.moscowPriority || 'Should',
          story.points || 3,
        ]
      );
      insertedStories.push(toStory({ ...r.rows[0], epic_title: story.epic }));
    }

    emitArtifactGenerated(projectId, 'user_stories', `Generated ${insertedStories.length} user stories`);

    res.json({
      epics:       Object.entries(epicMap).map(([title, id]) => ({ id: String(id), title })),
      userStories: insertedStories,
      counts: { epics: Object.keys(epicMap).length, stories: insertedStories.length },
    });
  } catch (err) {
    next(err);
  }
};

// ── Risks / dependencies (static per project, stored in project memory) ───────
const getRisksAndDeps = async (req, res, next) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'ValidationError', message: 'projectId required' });

    const result = await query(
      "SELECT value FROM project_memory WHERE project_id = $1 AND key = 'risks_deps' AND namespace = 'requirements'",
      [projectId]
    );

    const data = result.rows[0]?.value || {
      risks: [],
      dependencies: [],
      assumptions: [],
      complexityScore: null,
    };

    res.json(data);
  } catch (err) {
    next(err);
  }
};

module.exports = {
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
};