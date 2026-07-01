const { query } = require('./database');
require('dotenv').config();

/**
 * Migration to add generated_artifacts table
 * This table provides a unified view of all AI-generated outputs
 */
async function migrateArtifacts() {
  console.log('🔄 Running generated_artifacts migration...');

  const migration = `
    CREATE TABLE IF NOT EXISTS generated_artifacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_execution_id UUID REFERENCES agent_executions(id) ON DELETE SET NULL,
      artifact_type VARCHAR(100) NOT NULL,
      content JSONB NOT NULL DEFAULT '{}',
      metadata JSONB DEFAULT '{}',
      version INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  try {
    await query(migration);
    console.log('  ✅ generated_artifacts table created');

    await query(`CREATE INDEX IF NOT EXISTS idx_artifacts_project ON generated_artifacts(project_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_artifacts_type ON generated_artifacts(artifact_type)`);
    console.log('  ✅ Indexes created');

    console.log('✅ Migration complete');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }

  process.exit(0);
}

migrateArtifacts();
