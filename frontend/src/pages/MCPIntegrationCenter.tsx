import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Cable,
  GitBranch,
  MessageSquare,
  FileText,
  Cloud,
  Database,
  Server,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Link2,
  Trash2,
  Activity,
  XCircle,
  X,
} from 'lucide-react';
import { Card, StatusBadge } from '../components/ui/Card';
import { apiRequest } from '../lib/api';

const INTEGRATION_TYPES = [
  'version-control',
  'issue-tracking',
  'cloud-infrastructure',
  'documentation',
  'database',
  'it-service-management',
  'other',
];

type MCPIntegration = {
  id: number;
  name: string;
  type: string;
  status: string;
  latency: number;
  last_sync: string | null;
  connected_agents: string[];
};

const integrationIcons: Record<string, React.ElementType> = {
  'GitHub': GitBranch,
  'Jira': MessageSquare,
  'AWS': Cloud,
  'Azure': Cloud,
  'Confluence': FileText,
  'PostgreSQL': Database,
  'ServiceNow': Server,
};

export function MCPIntegrationCenter() {
  const [selectedIntegration, setSelectedIntegration] = useState<number | null>(null);
  const [integrations, setIntegrations] = useState<MCPIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', type: INTEGRATION_TYPES[0], url: '' });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const loadIntegrations = async () => {
    setLoading(true);
    try {
      const data = await apiRequest<MCPIntegration[]>('/mcp/integrations');
      setIntegrations(data || []);
    } catch {
      setIntegrations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadIntegrations(); }, []);

  const handleSync = async (id: number) => {
    setSyncing(id);
    try {
      await apiRequest(`/mcp/integrations/${id}/sync`, { method: 'PATCH' });
      await loadIntegrations();
    } catch {
      // ignore
    } finally {
      setSyncing(null);
    }
  };

  const handleAddIntegration = async () => {
    if (!addForm.name.trim()) { setAddError('Name is required.'); return; }
    setAdding(true);
    setAddError(null);
    try {
      await apiRequest('/mcp/integrations', {
        method: 'POST',
        body: {
          name: addForm.name.trim(),
          type: addForm.type,
          config: addForm.url.trim() ? { url: addForm.url.trim() } : {},
          connected_agents: [],
          enabled: true,
        },
      });
      setShowAddModal(false);
      setAddForm({ name: '', type: INTEGRATION_TYPES[0], url: '' });
      await loadIntegrations();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to add integration');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: number) => {
    setRemoving(id);
    try {
      await apiRequest(`/mcp/integrations/${id}`, { method: 'DELETE' });
      if (selectedIntegration === id) setSelectedIntegration(null);
      await loadIntegrations();
    } catch {
      // ignore
    } finally {
      setRemoving(null);
    }
  };

  const connectedCount = integrations.filter((i) => i.status === 'connected').length;
  const errorCount = integrations.filter((i) => i.status === 'error').length;
  const syncingCount = integrations.filter((i) => i.status === 'syncing').length;

  const selectedDetails = integrations.find((i) => i.id === selectedIntegration);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">MCP Integration Center</h1>
          <p className="mt-1 text-sm text-text-muted">Manage enterprise integrations and connections</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={loadIntegrations} className="btn-ghost text-sm" disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh All
          </button>
          <button onClick={() => setShowAddModal(true)} className="btn-secondary text-sm">
            <Link2 className="mr-2 h-4 w-4" />
            Add Integration
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="text-center">
          <CheckCircle2 className="h-6 w-6 text-status-success mx-auto mb-2" />
          <p className="text-2xl font-bold text-status-success">{connectedCount}</p>
          <p className="text-xs text-text-muted">Connected</p>
        </Card>
        <Card className="text-center">
          <Activity className="h-6 w-6 text-status-warning mx-auto mb-2" />
          <p className="text-2xl font-bold text-status-warning">{syncingCount}</p>
          <p className="text-xs text-text-muted">Syncing</p>
        </Card>
        <Card className="text-center">
          <AlertTriangle className="h-6 w-6 text-status-error mx-auto mb-2" />
          <p className="text-2xl font-bold text-status-error">{errorCount}</p>
          <p className="text-xs text-text-muted">Errors</p>
        </Card>
        <Card className="text-center">
          <Cable className="h-6 w-6 text-ey-yellow mx-auto mb-2" />
          <p className="text-2xl font-bold text-text-primary">{integrations.length}</p>
          <p className="text-xs text-text-muted">Total Integrations</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <h3 className="section-title">Enterprise Integrations</h3>
            {loading ? (
              <div className="py-10 text-center text-text-muted">
                <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 text-ey-yellow" />
                Loading integrations…
              </div>
            ) : integrations.length === 0 ? (
              <div className="py-10 text-center">
                <Cable className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                <p className="text-sm text-text-muted">No integrations configured yet.</p>
                <button onClick={() => setShowAddModal(true)} className="btn-primary text-sm mt-4">
                  <Link2 className="mr-2 h-4 w-4" />
                  Add Integration
                </button>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {integrations.map((integration) => {
                  const Icon = integrationIcons[integration.name] || Cable;
                  const statusColors: Record<string, string> = {
                    connected: 'text-status-success bg-status-success/10',
                    disconnected: 'text-text-muted bg-dark-bg',
                    error: 'text-status-error bg-status-error/10',
                    syncing: 'text-status-warning bg-status-warning/10',
                  };
                  const isSyncing = syncing === integration.id;
                  return (
                    <motion.div
                      key={integration.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`rounded-lg border p-4 cursor-pointer transition-all hover:border-ey-yellow/50 ${
                        selectedIntegration === integration.id
                          ? 'border-ey-yellow/50 bg-ey-yellow/5'
                          : 'border-dark-border bg-dark-bg'
                      }`}
                      onClick={() => setSelectedIntegration(integration.id)}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${statusColors[integration.status] || statusColors.disconnected}`}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-text-primary">{integration.name}</p>
                            <p className="text-[10px] text-text-muted">{integration.type}</p>
                          </div>
                        </div>
                        <StatusBadge status={integration.status as any}>
                          {integration.status}
                        </StatusBadge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded bg-dark-card p-2">
                          <p className="text-text-muted">Latency</p>
                          <p className="text-text-primary">{integration.latency || '-'}ms</p>
                        </div>
                        <div className="rounded bg-dark-card p-2">
                          <p className="text-text-muted">Last Sync</p>
                          <p className="text-text-primary">
                            {integration.last_sync ? new Date(integration.last_sync).toLocaleTimeString() : '-'}
                          </p>
                        </div>
                      </div>

                      {integration.connected_agents.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {integration.connected_agents.map((agent) => (
                            <span key={agent} className="text-[10px] text-text-muted bg-dark-card px-2 py-0.5 rounded">
                              {agent}
                            </span>
                          ))}
                        </div>
                      )}

                      <button
                        onClick={(e) => { e.stopPropagation(); handleSync(integration.id); }}
                        disabled={isSyncing}
                        className="mt-3 w-full btn-ghost text-xs py-1"
                      >
                        <RefreshCw className={`mr-1 h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
                        {isSyncing ? 'Syncing…' : 'Sync Now'}
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </Card>

          {selectedDetails && (
            <Card>
              <h3 className="section-title">Diagnostics — {selectedDetails.name}</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-lg bg-dark-bg p-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-text-muted" />
                    <span className="text-sm text-text-primary">Connection Status</span>
                  </div>
                  <StatusBadge status={selectedDetails.status === 'connected' ? 'success' : 'error'}>
                    {selectedDetails.status}
                  </StatusBadge>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-dark-bg p-3">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-text-muted" />
                    <span className="text-sm text-text-primary">API Response Time</span>
                  </div>
                  <span className={`text-sm ${selectedDetails.latency > 0 ? 'text-status-success' : 'text-text-muted'}`}>
                    {selectedDetails.latency > 0 ? `${selectedDetails.latency}ms` : 'N/A'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-dark-bg p-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-text-muted" />
                    <span className="text-sm text-text-primary">Last Synced</span>
                  </div>
                  <span className="text-sm text-text-primary">
                    {selectedDetails.last_sync ? new Date(selectedDetails.last_sync).toLocaleString() : 'Never'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <button onClick={() => handleSync(selectedDetails.id)} className="btn-secondary text-sm">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Re-sync
                  </button>
                  <button
                    onClick={() => handleRemove(selectedDetails.id)}
                    disabled={removing === selectedDetails.id}
                    className="btn-secondary text-sm text-status-error disabled:opacity-50"
                  >
                    {removing === selectedDetails.id ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    Remove
                  </button>
                </div>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="section-title mb-0">Integration Status</h3>
              <span className="flex items-center gap-1 text-xs text-status-success">
                <span className="h-2 w-2 rounded-full bg-status-success animate-pulse" />
                Live
              </span>
            </div>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {integrations.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-start gap-2 rounded-lg p-2 ${
                    item.status === 'error' ? 'bg-status-error/5 border border-status-error/20' :
                    item.status === 'syncing' ? 'bg-status-warning/5 border border-status-warning/20' :
                    'bg-dark-bg'
                  }`}
                >
                  {item.status === 'connected' && <CheckCircle2 className="h-4 w-4 text-status-success flex-shrink-0" />}
                  {item.status === 'error' && <XCircle className="h-4 w-4 text-status-error flex-shrink-0" />}
                  {item.status === 'syncing' && <RefreshCw className="h-4 w-4 text-status-warning animate-spin flex-shrink-0" />}
                  {item.status === 'disconnected' && <XCircle className="h-4 w-4 text-text-muted flex-shrink-0" />}
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-text-primary">{item.name}</span>
                      <span className="text-[10px] text-text-muted">{item.status}</span>
                    </div>
                    <p className="text-[10px] text-text-muted mt-0.5">{item.type}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="section-title">Connected Agents</h3>
            <div className="space-y-2">
              {Array.from(new Set(integrations.flatMap((i) => i.connected_agents))).map((agent) => (
                <div key={agent} className="flex items-center justify-between text-xs">
                  <span className="text-text-primary">{agent}</span>
                  <span className="text-status-success">Connected</span>
                </div>
              ))}
              {integrations.every((i) => i.connected_agents.length === 0) && (
                <p className="text-xs text-text-muted">No agents connected yet</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Add Integration modal — wired to the real POST /mcp/integrations
          endpoint. The URL field is stored in `config.url`, which the
          backend's Sync Now action uses for a genuine connectivity check. */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-dark-bg/80 backdrop-blur-sm"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="bg-dark-card border border-dark-border rounded-lg w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-dark-border p-4">
              <h3 className="text-lg font-semibold text-text-primary">Add Integration</h3>
              <button onClick={() => setShowAddModal(false)} className="rounded-lg p-2 text-text-muted hover:bg-dark-bg hover:text-text-primary">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {addError && <div className="text-xs text-status-error">{addError}</div>}
              <div>
                <label className="text-xs text-text-muted mb-1 block">Name</label>
                <input
                  className="input-field w-full text-sm"
                  placeholder="e.g. GitHub"
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">Type</label>
                <select
                  className="input-field w-full text-sm"
                  value={addForm.type}
                  onChange={(e) => setAddForm({ ...addForm, type: e.target.value })}
                >
                  {INTEGRATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">URL (optional)</label>
                <input
                  className="input-field w-full text-sm"
                  placeholder="https://api.example.com/health"
                  value={addForm.url}
                  onChange={(e) => setAddForm({ ...addForm, url: e.target.value })}
                />
                <p className="text-[10px] text-text-muted mt-1">If set, "Sync Now" performs a real connectivity check against this URL.</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-dark-border p-4">
              <button onClick={() => setShowAddModal(false)} className="btn-ghost text-sm">Cancel</button>
              <button onClick={handleAddIntegration} disabled={adding} className="btn-primary text-sm disabled:opacity-50">
                {adding ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                Add Integration
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
