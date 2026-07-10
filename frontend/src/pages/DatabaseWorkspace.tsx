import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Database,
  Table2,
  Link2,
  Key,
  FileCode2,
  Download,
  RefreshCw,
  CheckCircle2,
  Clock,
  FileJson,
  FileType,
} from 'lucide-react';
import { Card, StatusBadge } from '../components/ui/Card';
import { Accordion, AccordionItem, BulletList } from '../components/ui/Accordion';
import { CodeBlock } from '../components/ui/CodeBlock';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import { buildApiUrl, fastApiRequest } from '../lib/api';

interface TimelineEvent {
  id: number;
  timestamp: string;
  agent: string;
  action: string;
  result: string;
  stage: string;
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h ago`;
  return `${Math.round(ms / 86400000)}d ago`;
}

export function DatabaseWorkspace() {
  const [activeTab, setActiveTab] = useState<'schema' | 'migrations' | 'sql' | 'relationships' | 'audit'>('schema');
  const [selectedTable, setSelectedTable] = useState<string | null>('users');

  const projectId = getSelectedProjectId();
  const { getDatabaseSchema, getApprovalStatus, loading, error, reload, downloadArtifact } = useUnifiedArtifacts(projectId);

  const [recentActivity, setRecentActivity] = useState<TimelineEvent[]>([]);

  useEffect(() => {
    if (!projectId) { setRecentActivity([]); return; }
    fastApiRequest<{ events: TimelineEvent[] }>(`/temporal/${projectId}/events`)
      .then((data) => {
        const dbEvents = (data.events || []).filter((e) =>
          e.agent.toLowerCase().includes('database') || e.stage.toLowerCase().includes('database')
        );
        setRecentActivity(dbEvents.slice(-4).reverse());
      })
      .catch(() => setRecentActivity([]));
  }, [projectId]);

  const dbData = getDatabaseSchema();

  const tables = dbData?.tables || [];
  const relationships = dbData?.relationships || [];
  const sqlDdl = dbData?.sql_ddl || '';
  const normalizationNotes = dbData?.normalization_notes || '';
  const auditTables = dbData?.audit_tables || [];
  const sampleData = dbData?.sample_data || {};
  const scalingStrategy = dbData?.scaling_strategy || '';
  const partitioningRecommendations = dbData?.partitioning_recommendations || '';
  const migration = dbData?.migrations || null;
  const approvalStatus = getApprovalStatus('sql_schema');

  const selectedTableData = tables.find((t: any) => t.name === selectedTable) || null;

  // Real, derived facts to replace fabricated compliance checkmarks —
  // only claims that can be verified directly from the generated schema.
  const foreignKeyColumnCount = tables.reduce(
    (acc: number, t: any) => acc + (t.columns || []).filter((c: any) => c.foreign_key).length,
    0
  );
  const totalIndexCount = tables.reduce((acc: number, t: any) => acc + (t.indexes?.length || 0), 0);

  const tableCount = tables.length;
  const relationshipCount = relationships.length;
  const indexCount = tables.reduce((acc: number, t: any) => acc + (t.indexes?.length || 0), 0);

  const handleExport = async (format: 'json' | 'md') => {
    if (!projectId) return;
    try {
      await downloadArtifact('sql_schema', format);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  const handleLegacyExport = async (format: string) => {
    if (!projectId) return;
    try {
      const url = buildApiUrl(`/documents/export-artifact?projectId=${projectId}&artifact_type=sql_schema&format=${format}`);
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `database_schema_${projectId}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Database Workspace</h1>
          <p className="mt-1 text-sm text-text-muted">Database schema designed by Database Agent</p>
        </div>
        <div className="flex items-center gap-3">
          {approvalStatus === 'Approved' ? (
            <StatusBadge status="success">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Approved
            </StatusBadge>
          ) : approvalStatus ? (
            <StatusBadge status="info">
              <Clock className="mr-1 h-3 w-3" />
              {approvalStatus}
            </StatusBadge>
          ) : null}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="text-center">
          <Table2 className="h-6 w-6 mx-auto text-ey-yellow mb-2" />
          <p className="text-2xl font-bold text-text-primary">{tables.length}</p>
          <p className="text-xs text-text-muted">Tables</p>
        </Card>
        <Card className="text-center">
          <Link2 className="h-6 w-6 mx-auto text-status-info mb-2" />
          <p className="text-2xl font-bold text-text-primary">{relationshipCount}</p>
          <p className="text-xs text-text-muted">Relationships</p>
        </Card>
        <Card className="text-center">
          <Key className="h-6 w-6 mx-auto text-status-warning mb-2" />
          <p className="text-2xl font-bold text-text-primary">{indexCount}</p>
          <p className="text-xs text-text-muted">Indexes</p>
        </Card>
        <Card className="text-center">
          <FileCode2 className="h-6 w-6 mx-auto text-status-success mb-2" />
          <p className="text-2xl font-bold text-text-primary">{migration ? migration.up.length : 0}</p>
          <p className="text-xs text-text-muted">Migration Statements</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: ER Diagram */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tabs */}
          <div className="flex border-b border-dark-border">
            {[
              { id: 'schema', label: 'Schema' },
              { id: 'migrations', label: 'Migrations' },
              { id: 'sql', label: 'SQL Preview' },
              { id: 'relationships', label: 'Relationships' },
              { id: 'audit', label: 'Audit & Sample Data' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-ey-yellow text-ey-yellow'
                    : 'border-transparent text-text-muted hover:text-text-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Interactive ER Diagram */}
          {activeTab === 'schema' && (
            <Card className="min-h-[400px]">
              <div className="flex h-full">
                {/* Table List */}
                <div className="w-1/3 border-r border-dark-border pr-4">
                  <p className="text-xs text-text-muted mb-3">Entities</p>
                  <div className="space-y-2">
                    {tables.map((table: any) => (
                      <button
                        key={table.name}
                        onClick={() => setSelectedTable(table.name)}
                        className={`w-full text-left rounded-lg p-2 transition-all ${
                          selectedTable === table.name
                            ? 'bg-ey-yellow/10 border border-ey-yellow/50'
                            : 'bg-dark-bg hover:bg-dark-cardHover'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-text-primary">{table.name}</span>
                          <span className="text-xs text-text-muted">{table.columns?.length || 0} cols</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Table Details */}
                <div className="flex-1 pl-4">
                  {selectedTableData && (
                    <motion.div
                      key={selectedTableData.name}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-text-primary">{selectedTableData.name}</h3>
                        <StatusBadge status="success">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Designed
                        </StatusBadge>
                      </div>

                      {/* Columns */}
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-dark-border">
                              <th className="text-left text-xs font-medium text-text-muted pb-2">Column</th>
                              <th className="text-left text-xs font-medium text-text-muted pb-2">Type</th>
                              <th className="text-left text-xs font-medium text-text-muted pb-2">Nullable</th>
                              <th className="text-left text-xs font-medium text-text-muted pb-2">Key</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(selectedTableData?.columns || []).map((col: any) => (
                              <tr key={col.name} className="border-b border-dark-border/30">
                                <td className="py-2 text-sm text-text-primary">{col.name}</td>
                                <td className="py-2 text-xs font-mono text-text-secondary">{col.type}</td>
                                <td className="py-2">
                                  {col.nullable ? (
                                    <span className="text-xs text-text-muted">NULL</span>
                                  ) : (
                                    <span className="text-xs text-status-error">NOT NULL</span>
                                  )}
                                </td>
                                <td className="py-2">
                                  {col.primary_key && <Key className="h-3 w-3 text-ey-yellow" />}
                                  {col.foreign_key && (
                                    <span className="text-xs text-status-info">FK -&gt; {col.foreign_key}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Indexes */}
                      <div className="mt-4">
                        <p className="text-xs text-text-muted mb-2">Indexes</p>
                        <div className="flex gap-2">
                          {(selectedTableData?.indexes || []).map((idx: any) => (
                            <span
                              key={idx}
                              className="rounded bg-dark-bg px-2 py-1 text-xs font-mono text-text-secondary"
                            >
                              {idx}
                            </span>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Migrations */}
          {activeTab === 'migrations' && (
            <Card>
              {!migration ? (
                <div className="py-8 text-center">
                  <FileCode2 className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                  <p className="text-sm text-text-muted">No migration generated yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <FileCode2 className="h-4 w-4 text-ey-yellow" />
                    <span className="text-sm font-medium text-text-primary">{migration.version}</span>
                  </div>
                  <div>
                    <p className="text-xs text-text-muted mb-2">Up ({migration.up.length} statement{migration.up.length === 1 ? '' : 's'})</p>
                    <CodeBlock language="sql" code={migration.up.join('\n\n')} maxHeight="300px" />
                  </div>
                  <div>
                    <p className="text-xs text-text-muted mb-2">Down ({migration.down.length} statement{migration.down.length === 1 ? '' : 's'})</p>
                    <CodeBlock language="sql" code={migration.down.join('\n\n')} maxHeight="300px" />
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* SQL Preview */}
          {activeTab === 'sql' && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="section-title mb-0">Generated SQL</h3>
                <div className="flex gap-1">
                  <button onClick={() => handleExport('json')} className="btn-ghost text-xs" title="Export JSON">
                    <FileJson className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleLegacyExport('pdf')} className="btn-ghost text-xs" title="Export PDF">
                    <FileType className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <CodeBlock
                language="sql"
                code={sqlDdl || `-- Generated by Database Agent
-- Schema: Banking Platform Core

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    kyc_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_kyc_status ON users(kyc_status);

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    account_number VARCHAR(20) NOT NULL UNIQUE,
    account_type VARCHAR(50) NOT NULL,
    balance DECIMAL(18,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);`}
                maxHeight="500px"
              />
            </Card>
          )}

          {/* Audit & Sample Data */}
          {activeTab === 'audit' && (
            <Card>
              {!normalizationNotes && auditTables.length === 0 && Object.keys(sampleData).length === 0 ? (
                <div className="py-8 text-center">
                  <Database className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                  <p className="text-sm text-text-muted">No normalization notes, audit tables, or sample data generated yet.</p>
                </div>
              ) : (
                <Accordion>
                  {normalizationNotes && (
                    <AccordionItem title="Normalization Notes" icon={Database} defaultOpen>
                      <p className="text-xs text-text-secondary leading-relaxed">{normalizationNotes}</p>
                    </AccordionItem>
                  )}
                  {auditTables.length > 0 && (
                    <AccordionItem title="Audit / History Tables" icon={FileCode2} badge={<span className="text-[10px] text-text-muted">{auditTables.length}</span>}>
                      <BulletList items={auditTables} />
                    </AccordionItem>
                  )}
                  {Object.entries(sampleData).map(([tableName, rows]) => (
                    <AccordionItem key={tableName} title={`Sample Data — ${tableName}`} icon={Table2} badge={<span className="text-[10px] text-text-muted">{(rows as any[]).length} rows</span>}>
                      <CodeBlock language="json" code={JSON.stringify(rows, null, 2)} maxHeight="300px" />
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </Card>
          )}

          {/* Relationships */}
          {activeTab === 'relationships' && (
            <Card>
              {relationships.length === 0 ? (
                <div className="min-h-[300px] flex items-center justify-center">
                  <div className="text-center">
                    <Link2 className="h-12 w-12 text-dark-border-light mx-auto mb-4" />
                    <p className="text-sm text-text-muted">No relationships defined yet.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {relationships.map((rel: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg bg-dark-bg p-3">
                      <Link2 className="h-4 w-4 text-status-info flex-shrink-0" />
                      <span className="text-sm text-text-primary font-medium">{rel.from_table}</span>
                      <span className="text-xs text-text-muted">{'-->'} {rel.type}{rel.via ? ` via ${rel.via}` : ''} {'-->'}</span>
                      <span className="text-sm text-text-primary font-medium">{rel.to_table}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>

        {/* Right Panel: Database Agent Activity */}
        <div className="space-y-6">
          {/* Agent Status — derived from whether a real schema actually exists yet */}
          <Card glow>
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tables.length > 0 ? 'bg-status-success/10' : 'bg-status-warning/10'}`}>
                <Database className={`h-5 w-5 ${tables.length > 0 ? 'text-status-success' : 'text-status-warning'}`} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">Database Agent</p>
                <p className="text-xs text-text-muted">
                  {tables.length > 0 ? `Schema designed — ${tables.length} table${tables.length === 1 ? '' : 's'}` : 'Waiting for architecture approval'}
                </p>
              </div>
              <StatusBadge status={tables.length > 0 ? 'success' : 'waiting'}>{tables.length > 0 ? 'Completed' : 'Waiting'}</StatusBadge>
            </div>
          </Card>

          {/* Recent Activity */}
          <Card>
            <h3 className="section-title">Recent Activity</h3>
            <div className="space-y-3">
              {recentActivity.length === 0 ? (
                <p className="text-xs text-text-muted">No database activity recorded yet.</p>
              ) : (
                recentActivity.map((item) => (
                  <div key={item.id} className="flex items-start gap-3">
                    <Clock className="h-3 w-3 text-text-muted mt-1" />
                    <div>
                      <p className="text-xs text-text-primary">{item.action}</p>
                      <p className="text-[10px] text-text-muted">{formatRelativeTime(item.timestamp)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Scaling & Partitioning — real agent-authored analysis, not
              fabricated percentage scores (there's no real perf-benchmark
              data to derive a "Read Performance: 85%" style number from) */}
          {(scalingStrategy || partitioningRecommendations) && (
            <Card>
              <h3 className="section-title">Scaling &amp; Partitioning</h3>
              <div className="space-y-3">
                {scalingStrategy && (
                  <div>
                    <p className="text-xs font-medium text-text-primary mb-1">Scaling Strategy</p>
                    <p className="text-[11px] text-text-muted leading-relaxed">{scalingStrategy}</p>
                  </div>
                )}
                {partitioningRecommendations && (
                  <div>
                    <p className="text-xs font-medium text-text-primary mb-1">Partitioning</p>
                    <p className="text-[11px] text-text-muted leading-relaxed">{partitioningRecommendations}</p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Schema Facts — real, verifiable counts from the generated
              schema, replacing compliance checkmarks the app has no way to
              actually verify (nothing here checks GDPR/SOC2/etc. compliance) */}
          <Card>
            <h3 className="section-title">Schema Facts</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Foreign Key Columns</span>
                <span className="text-text-primary font-medium">{foreignKeyColumnCount}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Indexes Defined</span>
                <span className="text-text-primary font-medium">{totalIndexCount}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Relationships Mapped</span>
                <span className="text-text-primary font-medium">{relationships.length}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Audit/History Tables</span>
                {auditTables.length > 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-status-success" />
                ) : (
                  <span className="text-text-muted">None generated</span>
                )}
              </div>
            </div>
          </Card>

          {/* Actions */}
          <div className="flex gap-2">
            <button className="btn-secondary flex-1 text-sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              Regenerate
            </button>
            <div className="flex items-center gap-1">
              <button onClick={() => handleExport('json')} className="btn-ghost text-xs" title="Export JSON">
                <FileJson className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => handleLegacyExport('pdf')} className="btn-ghost text-xs" title="Export PDF">
                <FileType className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}