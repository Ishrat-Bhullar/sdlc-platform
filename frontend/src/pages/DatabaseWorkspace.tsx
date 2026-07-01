import { useState, useMemo } from 'react';
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
  AlertTriangle,
  FileJson,
  FileType,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar } from '../components/ui/Card';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import { buildApiUrl } from '../lib/api';

export function DatabaseWorkspace() {
  const [activeTab, setActiveTab] = useState<'schema' | 'migrations' | 'sql' | 'relationships'>('schema');
  const [selectedTable, setSelectedTable] = useState<string | null>('users');

  const projectId = getSelectedProjectId();
  const { getDatabaseSchema, loading, error, reload, downloadArtifact } = useUnifiedArtifacts(projectId);

  const dbData = getDatabaseSchema();

  const tables = dbData?.tables || [];
  const relationships = dbData?.relationships || [];
  const sqlDdl = dbData?.sql_ddl || '';

  const selectedTableData = tables.find((t: any) => t.name === selectedTable) || null;

  const migrationStatus = [
    { id: 'M001', name: 'Initial Schema', status: 'applied', timestamp: new Date(Date.now() - 86400000) },
    { id: 'M002', name: 'Add Audit Tables', status: 'applied', timestamp: new Date(Date.now() - 43200000) },
    { id: 'M003', name: 'Add Indexes', status: 'pending', timestamp: null },
    { id: 'M004', name: 'Partitioning Setup', status: 'pending', timestamp: null },
  ];

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
          <StatusBadge status="info">
            <Clock className="mr-1 h-3 w-3" />
            Pending Approval
          </StatusBadge>
          <button className="btn-primary text-sm">
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Approve Schema
          </button>
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
          <p className="text-2xl font-bold text-text-primary">2</p>
          <p className="text-xs text-text-muted">Migrations Applied</p>
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
              <div className="space-y-3">
                {migrationStatus.map((migration) => (
                  <div
                    key={migration.id}
                    className="flex items-center justify-between rounded-lg bg-dark-bg p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-8 rounded flex items-center justify-center ${
                        migration.status === 'applied' ? 'bg-status-success/10' : 'bg-dark-card'
                      }`}>
                        {migration.status === 'applied' ? (
                          <CheckCircle2 className="h-4 w-4 text-status-success" />
                        ) : (
                          <Clock className="h-4 w-4 text-text-muted" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary">{migration.name}</p>
                        <p className="text-xs text-text-muted">{migration.id}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <StatusBadge status={migration.status === 'applied' ? 'success' : 'pending'}>
                        {migration.status}
                      </StatusBadge>
                      {migration.timestamp && (
                        <p className="text-xs text-text-muted mt-1">{migration.timestamp.toLocaleDateString()}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
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
              <div className="code-block text-xs leading-relaxed">
                <pre className="text-text-secondary">
                  {sqlDdl ? sqlDdl : `-- Generated by Database Agent
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
                </pre>
              </div>
            </Card>
          )}

          {/* Relationships */}
          {activeTab === 'relationships' && (
            <Card>
              <div className="min-h-[300px] flex items-center justify-center">
                <div className="text-center">
                  <Link2 className="h-12 w-12 text-dark-border-light mx-auto mb-4" />
                  <p className="text-sm text-text-muted">Relationship visualization</p>
                  <p className="text-xs text-text-muted mt-1">users {'<->'} accounts {'<->'} transactions</p>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Right Panel: Database Agent Activity */}
        <div className="space-y-6">
          {/* Agent Status */}
          <Card glow>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-status-warning/10">
                <Database className="h-5 w-5 text-status-warning" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">Database Agent</p>
                <p className="text-xs text-text-muted">Waiting for architecture approval</p>
              </div>
              <StatusBadge status="waiting">Waiting</StatusBadge>
            </div>
          </Card>

          {/* Recent Activity */}
          <Card>
            <h3 className="section-title">Recent Activity</h3>
            <div className="space-y-3">
              {[
                { time: '2h ago', action: 'Generated schema for 6 tables' },
                { time: '2.5h ago', action: 'Created index recommendations' },
                { time: '3h ago', action: 'Analyzed relationships' },
                { time: '3.5h ago', action: 'Started schema generation' },
              ].map((item, index) => (
                <div key={index} className="flex items-start gap-3">
                  <Clock className="h-3 w-3 text-text-muted mt-1" />
                  <div>
                    <p className="text-xs text-text-primary">{item.action}</p>
                    <p className="text-[10px] text-text-muted">{item.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Performance Estimates */}
          <Card>
            <h3 className="section-title">Performance Estimates</h3>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-muted">Read Performance</span>
                  <span className="text-status-success">Optimal</span>
                </div>
                <ProgressBar value={85} color="green" />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-muted">Write Performance</span>
                  <span className="text-status-success">Good</span>
                </div>
                <ProgressBar value={75} color="green" />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-muted">Query Optimization</span>
                  <span className="text-ey-yellow">In Progress</span>
                </div>
                <ProgressBar value={60} color="yellow" />
              </div>
            </div>
          </Card>

          {/* Compliance Check */}
          <Card>
            <h3 className="section-title">Compliance Check</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">ACID Compliance</span>
                <CheckCircle2 className="h-4 w-4 text-status-success" />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Audit Trail Tables</span>
                <CheckCircle2 className="h-4 w-4 text-status-success" />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Data Encryption Fields</span>
                <CheckCircle2 className="h-4 w-4 text-status-success" />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">GDPR Compliance</span>
                <AlertTriangle className="h-4 w-4 text-status-warning" />
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