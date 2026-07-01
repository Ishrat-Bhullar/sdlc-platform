const { query } = require('../config/database');
const aiService = require('../services/aiService');
const { emitArtifactGenerated, emitApprovalRequested } = require('../websocket/progressSocket');

// ── Default components matching frontend mockArchitectureComponents shape ──────
const DEFAULT_COMPONENTS = [
  { id: '1', name: 'Web Application',     type: 'frontend',  connections: ['2'] },
  { id: '2', name: 'API Gateway',         type: 'api',       connections: ['3','4','5','6','7'] },
  { id: '3', name: 'Auth Service',        type: 'service',   connections: ['8','9'] },
  { id: '4', name: 'User Service',        type: 'service',   connections: ['8','9'] },
  { id: '5', name: 'Account Service',     type: 'service',   connections: ['8','9','10'] },
  { id: '6', name: 'Transaction Service', type: 'service',   connections: ['8','10','11'] },
  { id: '7', name: 'Notification Service',type: 'service',   connections: ['12','9'] },
  { id: '8', name: 'PostgreSQL',          type: 'database',  connections: [] },
  { id: '9', name: 'Redis Cache',         type: 'database',  connections: [] },
  { id: '10',name: 'Kafka MQ',            type: 'api',       connections: [] },
  { id: '11',name: 'Elasticsearch',       type: 'database',  connections: [] },
  { id: '12',name: 'SendGrid',            type: 'external',  connections: [] },
];

const DEFAULT_DECISIONS = [
  { id: '1', title: 'Microservices Architecture',   rationale: 'Enables independent scaling and deployment of services',         tradeoffs: 'Increased operational complexity, network latency' },
  { id: '2', title: 'Event-Driven Communication',   rationale: 'Decouples services and improves resilience',                     tradeoffs: 'Eventual consistency, debugging complexity' },
  { id: '3', title: 'API Gateway Pattern',          rationale: 'Centralised authentication, rate limiting, routing',             tradeoffs: 'Single point of failure, added latency' },
  { id: '4', title: 'PostgreSQL for Primary Storage',rationale: 'ACID compliance, strong ecosystem, familiar tooling',           tradeoffs: 'Horizontal scaling limitations' },
];

const DEFAULT_TECH_STACK = [
  { name: 'React 18',      category: 'Frontend',        reason: 'Component reusability, large ecosystem' },
  { name: 'Node.js 20',    category: 'Backend',         reason: 'JavaScript full-stack, async I/O' },
  { name: 'PostgreSQL 15', category: 'Database',        reason: 'ACID, JSONB support, reliability' },
  { name: 'Redis 7',       category: 'Cache',           reason: 'Performance, pub/sub, flexibility' },
  { name: 'Kafka',         category: 'Messaging',       reason: 'High throughput, event streaming' },
  { name: 'Docker/K8s',   category: 'Infrastructure',   reason: 'Containerisation, orchestration' },
];

const DEFAULT_TRADEOFFS = [
  { label: 'Complexity vs Scalability', value: 60, rating: 'Balanced',  color: 'yellow' },
  { label: 'Cost vs Performance',       value: 80, rating: 'Optimized', color: 'green'  },
  { label: 'Flexibility vs Simplicity', value: 70, rating: 'Flexible',  color: 'blue'   },
];

// ── helpers ───────────────────────────────────────────────────────────────────
const toProposal = (row) => ({
  id:            String(row.id),
  projectId:     String(row.project_id),
  pattern:       row.pattern || 'Microservices',
  techStack:     row.tech_stack || {},
  services:      row.services || [],
  apiStyle:      row.api_style || 'REST',
  justification: row.justification || '',
  diagrams:      row.diagrams || {},
  status:        row.status || 'draft',
  approvedBy:    row.approved_by,
  approvedAt:    row.approved_at,
  version:       row.version || 1,
  createdAt:     row.created_at,
});

// ── Get architecture for a project ───────────────────────────────────────────
const getArchitecture = async (req, res, next) => {
  try {
    const { projectId } = req.params;

    const propResult = await query(
      'SELECT * FROM architecture_proposals WHERE project_id = $1 ORDER BY version DESC LIMIT 1',
      [projectId]
    );

    const agentResult = await query(
      "SELECT * FROM agent_executions WHERE project_id = $1 AND agent_type = 'architect' ORDER BY id DESC LIMIT 1",
      [projectId]
    );

    const approvalResult = await query(
      "SELECT * FROM approvals WHERE project_id = $1 AND type = 'architecture' ORDER BY created_at DESC LIMIT 1",
      [projectId]
    );

    const agent = agentResult.rows[0] || null;
    const proposal = propResult.rows[0] || null;

    // Parse stored components or fall back to defaults
    let components = DEFAULT_COMPONENTS;
    let decisions  = DEFAULT_DECISIONS;
    let techStack  = DEFAULT_TECH_STACK;
    let tradeoffs  = DEFAULT_TRADEOFFS;

    if (proposal?.services?.length) {
      components = proposal.services;
    }
    if (proposal?.tech_stack && Object.keys(proposal.tech_stack).length) {
      techStack = Object.entries(proposal.tech_stack).map(([category, name], i) => ({
        name, category, reason: 'AI recommended',
      }));
    }

    res.json({
      proposal: proposal ? toProposal(proposal) : null,
      components,
      designDecisions: decisions,
      techStack,
      tradeoffs,
      stats: {
        services:     components.filter((c) => c.type === 'service').length,
        apiEndpoints: 47,
        databases:    components.filter((c) => c.type === 'database').length,
        availability: '99.9%',
      },
      agent: agent ? {
        name:        agent.agent_name,
        status:      agent.status,
        progress:    agent.progress || 0,
        currentTask: agent.current_task || 'Designing microservices architecture',
      } : null,
      approval: approvalResult.rows[0] ? {
        id:        String(approvalResult.rows[0].id),
        status:    approvalResult.rows[0].status,
        riskLevel: approvalResult.rows[0].risk_level,
      } : null,
      version:     proposal?.version || 1,
      lastUpdated: proposal?.created_at || new Date(),
    });
  } catch (err) {
    next(err);
  }
};

// ── AI-generate architecture ──────────────────────────────────────────────────
const generateArchitecture = async (req, res, next) => {
  try {
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ error: 'ValidationError', message: 'projectId is required' });

    const projResult = await query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (!projResult.rows.length) return res.status(404).json({ error: 'NotFound', message: 'Project not found' });
    const project = projResult.rows[0];

    // Fetch requirements for context
    const reqResult = await query(
      "SELECT description FROM requirements WHERE project_id = $1 ORDER BY id LIMIT 20",
      [projectId]
    );
    const reqContext = reqResult.rows.map((r) => r.description).join('\n');

    const aiResult = await aiService.complete(
      `Design a software architecture for: ${project.description || project.name}
       Requirements context:\n${reqContext || 'General enterprise application'}
       Return JSON with keys: pattern, justification, techStack (object category->name),
       services (array of {id,name,type,connections[]}),
       apiStyle, diagrams (object {systemContext,sequenceLogin} as mermaid strings).`,
      {
        systemPrompt: 'You are an expert software architect. Return valid JSON only.',
        userId: req.user?.id,
      }
    );

    let parsed;
    try { parsed = JSON.parse(aiResult.text); } catch { parsed = {}; }

    // Get current version
    const versionResult = await query(
      'SELECT COALESCE(MAX(version),0)+1 AS next_version FROM architecture_proposals WHERE project_id = $1',
      [projectId]
    );
    const nextVersion = versionResult.rows[0].next_version;

    const inserted = await query(
      `INSERT INTO architecture_proposals
         (project_id, pattern, tech_stack, services, api_style, justification, diagrams, status, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8) RETURNING *`,
      [
        projectId,
        parsed.pattern || 'Microservices',
        JSON.stringify(parsed.techStack || {}),
        JSON.stringify(parsed.services || DEFAULT_COMPONENTS),
        parsed.apiStyle || 'REST',
        parsed.justification || '',
        JSON.stringify(parsed.diagrams || {}),
        nextVersion,
      ]
    );

    // Record temporal event
    await query(
      `INSERT INTO temporal_events (project_id, agent_name, agent_type, stage, action, result)
       VALUES ($1,'Architect Agent','architect','Architecture','Generated architecture proposal','Architecture v${nextVersion} created')`,
      [projectId]
    );

    // Create pending approval
    const approval = await query(
      `INSERT INTO approvals (project_id, type, title, description, risk_level, status)
       VALUES ($1,'architecture',$2,$3,'medium','pending') RETURNING id`,
      [
        projectId,
        `Architecture Design v${nextVersion}: ${parsed.pattern || 'Microservices'} Pattern`,
        parsed.justification || `Proposed ${parsed.pattern || 'microservices'} architecture for ${project.name}`,
      ]
    );

    emitArtifactGenerated(projectId, 'architecture', `Architecture v${nextVersion} generated`);
    emitApprovalRequested(projectId, approval.rows[0].id, 'architecture', `Architecture Design v${nextVersion}`);

    const proposal = toProposal(inserted.rows[0]);
    res.json({
      proposal,
      components: parsed.services || DEFAULT_COMPONENTS,
      designDecisions: DEFAULT_DECISIONS,
      techStack: DEFAULT_TECH_STACK,
      tradeoffs:  DEFAULT_TRADEOFFS,
      stats: { services: (parsed.services || DEFAULT_COMPONENTS).filter((c) => c.type === 'service').length, apiEndpoints: 47, databases: 4, availability: '99.9%' },
    });
  } catch (err) {
    next(err);
  }
};

// ── Approve / reject architecture ─────────────────────────────────────────────
const approveArchitecture = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { decision = 'approved', comment = '' } = req.body;

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'ValidationError', message: 'decision must be approved or rejected' });
    }

    // Update latest proposal status
    await query(
      "UPDATE architecture_proposals SET status = $1, approved_by = $2, approved_at = NOW() WHERE project_id = $3 AND version = (SELECT MAX(version) FROM architecture_proposals WHERE project_id = $3)",
      [decision, req.user?.id, projectId]
    );

    // Update or create approval record
    await query(
      `INSERT INTO approvals (project_id, type, title, description, risk_level, status, comment, owner_id)
       VALUES ($1,'architecture','Architecture Review','Architecture design reviewed','medium',$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      [projectId, decision, comment, req.user?.id]
    );

    await query(
      "UPDATE approvals SET status = $1, comment = $2, owner_id = $3, decided_at = NOW() WHERE project_id = $4 AND type = 'architecture'",
      [decision, comment, req.user?.id, projectId]
    );

    await query(
      `INSERT INTO temporal_events (project_id, agent_name, agent_type, stage, action, result)
       VALUES ($1,'Governance','approval','Architecture','Architecture ${decision}','Decision recorded')`,
      [projectId]
    );

    res.json({ message: `Architecture ${decision}`, projectId, decision });
  } catch (err) {
    next(err);
  }
};

// ── Export architecture as JSON ───────────────────────────────────────────────
const exportArchitecture = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const result = await query(
      'SELECT * FROM architecture_proposals WHERE project_id = $1 ORDER BY version DESC LIMIT 1',
      [projectId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'NotFound', message: 'No architecture found' });

    const proposal = result.rows[0];
    res.setHeader('Content-Disposition', `attachment; filename="architecture_v${proposal.version}.json"`);
    res.json({
      version:   proposal.version,
      pattern:   proposal.pattern,
      techStack: proposal.tech_stack,
      services:  proposal.services,
      apiStyle:  proposal.api_style,
      diagrams:  proposal.diagrams,
      exportedAt: new Date(),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getArchitecture,
  generateArchitecture,
  approveArchitecture,
  exportArchitecture,
};