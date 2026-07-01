const { query } = require('./database');
require('dotenv').config();

const migrations = [
  // 001 - Users & Auth
  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'developer',
    avatar_url TEXT,
    timezone VARCHAR(100) DEFAULT 'UTC',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS session_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address VARCHAR(50),
    device_info TEXT,
    action VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 002 - Projects
  `CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    project_type VARCHAR(100) DEFAULT 'web-app',
    execution_mode VARCHAR(50) DEFAULT 'auto',
    build_type VARCHAR(50) DEFAULT 'private-enterprise',
    status VARCHAR(50) DEFAULT 'draft',
    progress INTEGER DEFAULT 0,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    tags TEXT[] DEFAULT '{}',
    category VARCHAR(100),
    deliverables JSONB DEFAULT '[]',
    manual_stages JSONB DEFAULT '[]',
    provider_settings JSONB DEFAULT '{}',
    requirements_text TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 003 - Agent Registry
  `CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL UNIQUE,
    phase VARCHAR(100),
    capabilities JSONB DEFAULT '[]',
    default_model VARCHAR(100) DEFAULT 'claude-sonnet-4-6',
    enabled BOOLEAN DEFAULT true,
    version VARCHAR(20) DEFAULT '1.0.0',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 004 - Agent Executions (per project)
  `CREATE TABLE IF NOT EXISTS agent_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_type VARCHAR(100) NOT NULL,
    agent_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'idle',
    priority INTEGER DEFAULT 0,
    execution_order INTEGER DEFAULT 0,
    current_task TEXT,
    progress INTEGER DEFAULT 0,
    runtime_seconds INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    cost_usd DECIMAL(10,4) DEFAULT 0,
    ai_provider VARCHAR(50),
    ai_model VARCHAR(100),
    input_data JSONB,
    output_data JSONB,
    error_message TEXT,
    retries INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 005 - Requirements
  `CREATE TABLE IF NOT EXISTS requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    req_id VARCHAR(50),
    description TEXT NOT NULL,
    category VARCHAR(100),
    priority VARCHAR(50) DEFAULT 'medium',
    risk_level VARCHAR(50) DEFAULT 'low',
    status VARCHAR(50) DEFAULT 'pending',
    source VARCHAR(100) DEFAULT 'ai-generated',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 006 - Epics & User Stories
  `CREATE TABLE IF NOT EXISTS epics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    priority VARCHAR(50) DEFAULT 'should',
    status VARCHAR(50) DEFAULT 'todo',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS user_stories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    epic_id UUID REFERENCES epics(id) ON DELETE SET NULL,
    story_id VARCHAR(50),
    title VARCHAR(500) NOT NULL,
    description TEXT,
    acceptance_criteria JSONB DEFAULT '[]',
    priority VARCHAR(50) DEFAULT 'should',
    moscow_priority VARCHAR(50) DEFAULT 'Should',
    status VARCHAR(50) DEFAULT 'todo',
    points INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 007 - Architecture
  `CREATE TABLE IF NOT EXISTS architecture_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    pattern VARCHAR(100),
    tech_stack JSONB DEFAULT '{}',
    services JSONB DEFAULT '[]',
    api_style VARCHAR(50) DEFAULT 'REST',
    justification TEXT,
    diagrams JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'draft',
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 008 - Database Schema
  `CREATE TABLE IF NOT EXISTS db_schemas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tables_json JSONB DEFAULT '[]',
    relationships_json JSONB DEFAULT '[]',
    migration_sql TEXT,
    erd_json JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'draft',
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 009 - Generated Code
  `CREATE TABLE IF NOT EXISTS generated_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_execution_id UUID REFERENCES agent_executions(id) ON DELETE SET NULL,
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(50),
    content TEXT,
    lines_of_code INTEGER DEFAULT 0,
    language VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS generated_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_execution_id UUID REFERENCES agent_executions(id) ON DELETE SET NULL,
    artifact_type VARCHAR(100) NOT NULL,
    content JSONB NOT NULL DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 010 - Code Review
  `CREATE TABLE IF NOT EXISTS code_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    quality_score INTEGER DEFAULT 0,
    security_score INTEGER DEFAULT 0,
    performance_score INTEGER DEFAULT 0,
    issues JSONB DEFAULT '[]',
    summary TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 011 - Approvals
  `CREATE TABLE IF NOT EXISTS approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    owner_id UUID REFERENCES users(id),
    risk_level VARCHAR(50) DEFAULT 'low',
    status VARCHAR(50) DEFAULT 'pending',
    comment TEXT,
    approved_by UUID REFERENCES users(id),
    decided_at TIMESTAMPTZ,
    item_version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 012 - Temporal Events (immutable audit log)
  `CREATE TABLE IF NOT EXISTS temporal_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_name VARCHAR(255) NOT NULL,
    agent_type VARCHAR(100),
    stage VARCHAR(100),
    action TEXT NOT NULL,
    result TEXT,
    input_hash TEXT,
    output_hash TEXT,
    input_data JSONB,
    output_data JSONB,
    duration_ms INTEGER,
    tokens_used INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 013 - MCP Integrations
  `CREATE TABLE IF NOT EXISTS mcp_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'disconnected',
    config JSONB DEFAULT '{}',
    connected_agents TEXT[] DEFAULT '{}',
    last_sync TIMESTAMPTZ,
    latency_ms INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 014 - Project Memory
  `CREATE TABLE IF NOT EXISTS project_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key VARCHAR(255) NOT NULL,
    value JSONB NOT NULL,
    namespace VARCHAR(100) DEFAULT 'general',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, key, namespace)
  )`,

  // 015 - Documents
  `CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    doc_type VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    content TEXT,
    file_format VARCHAR(50) DEFAULT 'pdf',
    file_size_bytes INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 016 - AI Model Settings (per user)
  `CREATE TABLE IF NOT EXISTS user_ai_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    provider VARCHAR(50) DEFAULT 'anthropic',
    model VARCHAR(100) DEFAULT 'claude-sonnet-4-6',
    openai_key_set BOOLEAN DEFAULT false,
    anthropic_key_set BOOLEAN DEFAULT false,
    gemini_key_set BOOLEAN DEFAULT false,
    ollama_url VARCHAR(255),
    ollama_model VARCHAR(100) DEFAULT 'llama3',
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_exec_project ON agent_executions(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_user_stories_project ON user_stories(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_temporal_events_project ON temporal_events(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_approvals_project ON approvals(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_generated_files_project ON generated_files(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_generated_artifacts_project ON generated_artifacts(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_generated_artifacts_type ON generated_artifacts(artifact_type)`,
];

async function migrate() {
  console.log('🔄 Running migrations...');
  for (let i = 0; i < migrations.length; i++) {
    try {
      await query(migrations[i]);
      console.log(`  ✅ Migration ${i + 1}/${migrations.length}`);
    } catch (err) {
      console.error(`  ❌ Migration ${i + 1} failed:`, err.message);
    }
  }
  console.log('✅ All migrations complete');
  process.exit(0);
}

migrate();
