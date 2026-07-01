const { query } = require('./database');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function seed() {
  console.log('🌱 Seeding database...');

  // Seed agent registry
  const agents = [
    { name: 'Requirement Agent', type: 'requirement', phase: 'Phase 1-2', default_model: 'claude-sonnet-4-6' },
    { name: 'Business Analyst Agent', type: 'business-analyst', phase: 'Phase 2', default_model: 'claude-sonnet-4-6' },
    { name: 'Architect Agent', type: 'architect', phase: 'Phase 3', default_model: 'claude-sonnet-4-6' },
    { name: 'UI/UX Agent', type: 'ui-ux', phase: 'Phase 3', default_model: 'gpt-4o' },
    { name: 'Database Agent', type: 'database', phase: 'Phase 4', default_model: 'claude-sonnet-4-6' },
    { name: 'Frontend Agent', type: 'frontend', phase: 'Phase 5', default_model: 'claude-sonnet-4-6' },
    { name: 'Backend Agent', type: 'backend', phase: 'Phase 5', default_model: 'claude-sonnet-4-6' },
    { name: 'Integration Agent', type: 'integration', phase: 'Phase 5', default_model: 'gpt-4o' },
    { name: 'Code Review Agent', type: 'code-review', phase: 'Phase 6', default_model: 'claude-sonnet-4-6' },
    { name: 'Testing Agent', type: 'testing', phase: 'Phase 6', default_model: 'gpt-4o' },
    { name: 'Security Agent', type: 'security', phase: 'Phase 6', default_model: 'claude-sonnet-4-6' },
    { name: 'Memory Agent', type: 'memory', phase: 'Phase 7', default_model: null },
    { name: 'Knowledge/RAG Agent', type: 'knowledge', phase: 'Phase 7', default_model: 'text-embedding-3-small' },
    { name: 'Approval Engine', type: 'approval', phase: 'Phase 8', default_model: null },
    { name: 'Temporal Engine', type: 'temporal', phase: 'Phase 8', default_model: null },
  ];

  for (const agent of agents) {
    await query(
      `INSERT INTO agents (name, type, phase, default_model)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (type) DO UPDATE SET name = EXCLUDED.name, phase = EXCLUDED.phase`,
      [agent.name, agent.type, agent.phase, agent.default_model]
    );
  }
  console.log('  ✅ Agent registry seeded');

  // Seed default admin user
  const passwordHash = await bcrypt.hash('Admin@123', 12);
  const userResult = await query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    ['EY Admin', 'admin@ey.com', passwordHash, 'admin']
  );

  if (userResult.rows.length > 0) {
    const userId = userResult.rows[0].id;
    
    // Default AI settings
    await query(
      `INSERT INTO user_ai_settings (user_id, provider, model)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, 'anthropic', 'claude-sonnet-4-6']
    );
    console.log('  ✅ Admin user created: admin@ey.com / Admin@123');
  } else {
    console.log('  ℹ️  Admin user already exists');
  }

  // Seed demo MCP integrations
  const integrations = [
    { name: 'GitHub', type: 'version-control', status: 'connected', latency_ms: 45, connected_agents: ['frontend', 'backend', 'devops'] },
    { name: 'Jira', type: 'issue-tracking', status: 'connected', latency_ms: 120, connected_agents: ['requirement', 'business-analyst'] },
    { name: 'AWS', type: 'cloud-infrastructure', status: 'connected', latency_ms: 89, connected_agents: ['devops', 'security'] },
    { name: 'Confluence', type: 'documentation', status: 'syncing', latency_ms: 150, connected_agents: ['documentation', 'business-analyst'] },
    { name: 'PostgreSQL', type: 'database', status: 'connected', latency_ms: 12, connected_agents: ['database', 'backend'] },
    { name: 'ServiceNow', type: 'it-service-management', status: 'disconnected', latency_ms: 0, connected_agents: [] },
    { name: 'Azure', type: 'cloud-infrastructure', status: 'error', latency_ms: 0, connected_agents: [] },
  ];

  for (const intg of integrations) {
    await query(
      `INSERT INTO mcp_integrations (name, type, status, latency_ms, connected_agents)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [intg.name, intg.type, intg.status, intg.latency_ms, intg.connected_agents]
    );
  }
  console.log('  ✅ MCP integrations seeded');

  console.log('✅ Seeding complete');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});