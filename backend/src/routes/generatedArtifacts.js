const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const projectId = req.query.project_id;
    const artifactType = req.query.artifact_type;

    if (!projectId) {
      return res.status(400).json({ error: 'ValidationError', message: 'project_id is required' });
    }

    const params = [projectId];
    let sql = `
      SELECT id, project_id, artifact_type, content, metadata, created_at, updated_at
      FROM generated_artifacts
      WHERE project_id = $1
    `;

    if (artifactType) {
      params.push(artifactType);
      sql += ` AND artifact_type = $${params.length}`;
    }

    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, params);

    const artifacts = result.rows.map((row) => ({
      id: row.id,
      project_id: row.project_id,
      artifact_type: row.artifact_type,
      content: (() => {
        try { return JSON.parse(row.content); } catch (_) { return row.content; }
      })(),
      metadata: (() => {
        try { return row.metadata ? JSON.parse(row.metadata) : null; } catch (_) { return row.metadata; }
      })(),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    return res.json(artifacts);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

