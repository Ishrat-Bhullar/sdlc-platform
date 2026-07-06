import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  Upload,
  Link2,
  Send,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Zap,
  FileSearch,
  Lightbulb,
  Layers,
  Edit3,
  Save,
  Download,
  BarChart3,
  Target,
  Shield,
  GitBranch,
  RefreshCw,
  FileJson,
  FileType,
  FileText as FileTextIcon,
  File,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Loader2,
  Database,
  Workflow,
  Code2,
  ListChecks,
  ShieldAlert,
  Boxes,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar } from '../components/ui/Card';
import { Accordion, AccordionItem, BulletList as AccordionBulletList } from '../components/ui/Accordion';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import { buildApiUrl, fastApiRequest } from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Requirement {
  id: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  source: string;
  risk_level?: string;
  business_rules?: string[];
  edge_cases?: string[];
  validations?: string[];
  workflow?: string[];
  acceptance_criteria?: Array<{ given: string; when: string; then: string }>;
  api_considerations?: { endpoints?: Array<{ method: string; path: string; desc: string; success: string; errors: string }>; notes?: string[] };
  ui_behavior?: string[];
  db_impact?: { primary_table?: string; columns_touched?: string[]; notes?: string[] };
  dependencies?: string[];
  constraints?: string[];
  assumptions?: string[];
  nfr_targets?: Record<string, string>;
}

interface Risk {
  id: string;
  description: string;
  probability: string;
  impact: string;
  mitigation: string;
  status: string;
}

interface Dependency {
  id: string;
  name: string;
  type: string;
  description: string;
  status: string;
  criticality: string;
}

interface AcceptanceCriterion {
  id: string;
  requirementId: string;
  description: string;
  testable: boolean;
  status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseContent(raw: string | Record<string, unknown>): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return { raw_text: raw }; }
  }
  return raw as Record<string, unknown>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RequirementsWorkspace() {
  const [activeTab, setActiveTab] = useState<'editor' | 'functional' | 'non-functional' | 'risks' | 'dependencies' | 'acceptance' | 'roles'>('editor');
  const [requirementText, setRequirementText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<Requirement>>({});

  const projectId = getSelectedProjectId();
  const { getRequirements, loading, error, reload, downloadArtifact } = useUnifiedArtifacts(projectId);

  const reqData = getRequirements();

  const requirements = reqData?.requirements || [];
  const assumptions = reqData?.assumptions || [];
  const risks = reqData?.risks || [];
  const dependencies = reqData?.dependencies || [];
  const isEnriched = !!(reqData as any)?.enriched;

  const [enriching, setEnriching] = useState(false);
  const handleEnrich = async () => {
    if (!projectId) return;
    setEnriching(true);
    try {
      await fastApiRequest('/generate/requirements-enrich', {
        method: 'POST',
        body: { project_id: Number(projectId) },
      });
      await reload();
    } catch (e) {
      console.error('Enrichment failed:', e);
    } finally {
      setEnriching(false);
    }
  };

  // Normalize requirements (preserve enriched fields via spread)
  const functionalReqs: Requirement[] = useMemo(() => {
    return requirements.filter((r: any) => r.category === 'Functional').map((r: any, idx: number) => ({
      ...r,
      id: String(r.id || `FR-${idx + 1}`),
      description: String(r.description || ''),
      category: String(r.category || 'Functional'),
      priority: String(r.priority || 'medium'),
      risk_level: String(r.risk_level || 'low'),
      status: String(r.status || 'pending'),
      source: String(r.source || 'AI Generated'),
    }));
  }, [requirements]);

  const nonFunctionalReqs: Requirement[] = useMemo(() => {
    return requirements.filter((r: any) => r.category === 'Non-Functional').map((r: any, idx: number) => ({
      ...r,
      id: String(r.id || `NFR-${idx + 1}`),
      description: String(r.description || ''),
      category: String(r.category || 'Non-Functional'),
      priority: String(r.priority || 'medium'),
      risk_level: String(r.risk_level || 'low'),
      status: String(r.status || 'pending'),
      source: String(r.source || 'AI Generated'),
    }));
  }, [requirements]);

  const riskItems: Risk[] = useMemo(() => {
    return risks.map((r: any, idx: number) => ({
      id: String(r.id || `RISK-${idx + 1}`),
      description: String(r.description || ''),
      probability: String(r.probability || 'medium'),
      impact: String(r.impact || 'medium'),
      mitigation: String(r.mitigation || ''),
      status: String(r.status || 'open'),
    }));
  }, [risks]);

  const dependencyItems: Dependency[] = useMemo(() => {
    return dependencies.map((d: any, idx: number) => ({
      id: String(d.id || `DEP-${idx + 1}`),
      name: String(d.name || ''),
      type: String(d.type || 'technical'),
      description: String(d.description || ''),
      status: String(d.status || 'pending'),
      criticality: String(d.criticality || 'medium'),
    }));
  }, [dependencies]);

  const acceptanceCriteria: AcceptanceCriterion[] = useMemo(() => {
    return (reqData?.acceptanceCriteria || []).map((ac: any, idx: number) => ({
      id: String(ac.id || `AC-${idx + 1}`),
      requirementId: String(ac.requirementId || ''),
      description: typeof ac === 'string' ? ac : String(ac.description || ''),
      testable: ac.testable !== false,
      status: String(ac.status || 'pending'),
    }));
  }, [reqData]);

  const userRoles = reqData?.user_roles || [];
  const traceability = reqData?.traceability || [];
  const errorScenarios = reqData?.error_scenarios || [];

  // Metrics
  const totalFunctional = functionalReqs.length;
  const totalNonFunctional = nonFunctionalReqs.length;
  const totalRisks = risks.length;
  const totalDependencies = dependencies.length;
  const totalAC = acceptanceCriteria.length;
  const highPriorityCount = [...functionalReqs, ...nonFunctionalReqs].filter((r) => r.priority === 'high' || r.priority === 'critical').length;

  // Edit handlers
  const startEdit = (req: Requirement) => {
    setEditingId(req.id);
    setEditValues({ ...req });
  };

  const saveEdit = () => {
    setEditingId(null);
    setEditValues({});
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({});
  };

  const noProject = !projectId;

  const handleExport = async (format: 'json' | 'md') => {
    if (!projectId) return;
    try {
      await downloadArtifact('requirements_doc', format);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  const handleLegacyExport = async (format: string) => {
    if (!projectId) return;
    try {
      const url = buildApiUrl(`/documents/export-artifact?projectId=${projectId}&artifact_type=requirements_doc&format=${format}`);
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `requirements_${projectId}.${format}`;
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
          <h1 className="text-2xl font-bold text-text-primary">Requirements Workspace</h1>
          <p className="mt-1 text-sm text-text-muted">Business requirements analysis and management</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status="success">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            {totalFunctional + totalNonFunctional} Requirements
          </StatusBadge>
          <StatusBadge status="warning">
            <AlertTriangle className="mr-1 h-3 w-3" />
            {totalRisks} Risks
          </StatusBadge>
          <button onClick={reload} className="btn-ghost text-sm" disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <div className="flex items-center gap-1">
            <button onClick={() => handleExport('json')} className="btn-ghost text-xs" title="Export JSON">
              <FileJson className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => handleExport('md')} className="btn-ghost text-xs" title="Export Markdown">
              <FileType className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => handleLegacyExport('pdf')} className="btn-ghost text-xs" title="Export PDF">
              <FileTextIcon className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => handleLegacyExport('docx')} className="btn-ghost text-xs" title="Export DOCX">
              <File className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <Card className="border-status-error/30 bg-status-error/5 text-sm text-status-error">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
            <button onClick={reload} className="ml-auto underline hover:no-underline">Retry</button>
          </div>
        </Card>
      )}

      {noProject ? (
        <Card className="py-10 text-center">
          <AlertTriangle className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">No project selected</p>
          <p className="text-xs text-text-muted mt-1">Select a project in the Dashboard to view requirements.</p>
        </Card>
      ) : (
        <>
          {/* Metrics row */}
          <div className="grid gap-3 md:grid-cols-5">
            <Card className="text-center py-3">
              <FileSearch className="h-5 w-5 text-status-info mx-auto mb-1" />
              <p className="text-xl font-bold text-text-primary">{functionalReqs.length}</p>
              <p className="text-[10px] text-text-muted">Functional</p>
            </Card>
            <Card className="text-center py-3">
              <Shield className="h-5 w-5 text-status-warning mx-auto mb-1" />
              <p className="text-xl font-bold text-text-primary">{nonFunctionalReqs.length}</p>
              <p className="text-[10px] text-text-muted">Non-Functional</p>
            </Card>
            <Card className="text-center py-3">
              <AlertTriangle className="h-5 w-5 text-status-error mx-auto mb-1" />
              <p className="text-xl font-bold text-text-primary">{riskItems.length}</p>
              <p className="text-[10px] text-text-muted">Risks</p>
            </Card>
            <Card className="text-center py-3">
              <GitBranch className="h-5 w-5 text-ey-yellow mx-auto mb-1" />
              <p className="text-xl font-bold text-text-primary">{dependencyItems.length}</p>
              <p className="text-[10px] text-text-muted">Dependencies</p>
            </Card>
            <Card className="text-center py-3">
              <CheckCircle2 className="h-5 w-5 text-status-success mx-auto mb-1" />
              <p className="text-xl font-bold text-text-primary">{acceptanceCriteria.length}</p>
              <p className="text-[10px] text-text-muted">Acceptance Criteria</p>
            </Card>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-dark-border">
            {[
              { id: 'editor', label: 'Requirement Editor', icon: Edit3 },
              { id: 'functional', label: 'Functional', icon: FileSearch },
              { id: 'non-functional', label: 'Non-Functional', icon: Shield },
              { id: 'risks', label: 'Risks', icon: AlertTriangle },
              { id: 'dependencies', label: 'Dependencies', icon: GitBranch },
              { id: 'acceptance', label: 'Acceptance Criteria', icon: CheckCircle2 },
              { id: 'roles', label: 'Roles & Traceability', icon: Boxes },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-ey-yellow text-ey-yellow'
                    : 'border-transparent text-text-muted hover:text-text-primary'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Editor tab */}
          {activeTab === 'editor' && (
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <Edit3 className="h-5 w-5 text-ey-yellow" />
                <h3 className="text-lg font-semibold text-text-primary">Requirement Editor</h3>
              </div>
              <textarea
                value={requirementText}
                onChange={(e) => setRequirementText(e.target.value)}
                placeholder="Enter or paste your business requirements here. Support for natural language, structured documents, or bullet points..."
                className="input-field h-48 w-full resize-none text-sm"
              />
              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button className="btn-ghost text-xs">
                    <Upload className="mr-1 h-3 w-3" />
                    Upload Document
                  </button>
                  <button className="btn-ghost text-xs">
                    <Link2 className="mr-1 h-3 w-3" />
                    Jira Sync
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn-secondary text-sm">
                    <FileSearch className="mr-1 h-4 w-4" />
                    Analyze Requirements
                  </button>
                  <button className="btn-primary text-sm">
                    <Send className="mr-1 h-4 w-4" />
                    Generate Architecture
                  </button>
                </div>
              </div>
            </Card>
          )}

          {/* Functional Requirements tab */}
          {activeTab === 'functional' && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="section-title mb-0">Functional Requirements</h3>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-text-muted">{functionalReqs.length} requirements</span>
                  <button onClick={handleEnrich} disabled={enriching} className="btn-ghost text-xs">
                    {enriching ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                    {isEnriched ? 'Re-enrich' : 'Enrich to Spec'}
                  </button>
                </div>
              </div>
              {functionalReqs.length === 0 ? (
                <div className="py-8 text-center">
                  <FileSearch className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                  <p className="text-sm text-text-muted">No functional requirements generated yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {functionalReqs.map((req) => (
                    <RequirementCard key={req.id} req={req} onEdit={() => startEdit(req)}
                      editing={editingId === req.id} editValues={editValues} setEditValues={setEditValues}
                      saveEdit={saveEdit} cancelEdit={cancelEdit} />
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Non-Functional Requirements tab (legacy hidden reference) */}
          {false && activeTab === 'functional' && (
            <Card>
              {functionalReqs.length === 0 ? null : (
                <div className="space-y-2">
                  {functionalReqs.map((req) => (
                    <div key={req.id} className="rounded-lg bg-dark-bg p-3">
                      {editingId === req.id ? (
                        <div className="space-y-2">
                          <input className="input-field text-xs w-full" value={editValues.description || ''} onChange={(e) => setEditValues({ ...editValues, description: e.target.value })} />
                          <div className="flex gap-2">
                            <select className="input-field text-xs" value={editValues.priority || 'medium'} onChange={(e) => setEditValues({ ...editValues, priority: e.target.value })}>
                              <option>low</option><option>medium</option><option>high</option><option>critical</option>
                            </select>
                            <button onClick={saveEdit} className="btn-ghost text-xs"><Save className="h-3 w-3" /> Save</button>
                            <button onClick={cancelEdit} className="btn-ghost text-xs">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-mono text-ey-yellow">{req.id}</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                                req.priority === 'critical' ? 'bg-status-error/10 text-status-error'
                                : req.priority === 'high' ? 'bg-status-warning/10 text-status-warning'
                                : 'bg-dark-border text-text-muted'
                              }`}>{req.priority}</span>
                            </div>
                            <p className="text-xs text-text-primary">{req.description}</p>
                            <p className="text-[10px] text-text-muted mt-1">Category: {req.category} · Source: {req.source}</p>
                          </div>
                          <button onClick={() => startEdit(req)} className="p-1 rounded hover:bg-dark-surface text-text-muted hover:text-ey-yellow">
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Non-Functional Requirements tab */}
          {activeTab === 'non-functional' && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="section-title mb-0">Non-Functional Requirements</h3>
                <span className="text-xs text-text-muted">{nonFunctionalReqs.length} requirements</span>
              </div>
              {nonFunctionalReqs.length === 0 ? (
                <div className="py-8 text-center">
                  <Shield className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                  <p className="text-sm text-text-muted">No non-functional requirements generated yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {nonFunctionalReqs.map((req) => (
                    <RequirementCard key={req.id} req={req} onEdit={() => startEdit(req)}
                      editing={editingId === req.id} editValues={editValues} setEditValues={setEditValues}
                      saveEdit={saveEdit} cancelEdit={cancelEdit} />
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Risks tab */}
          {activeTab === 'risks' && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="section-title mb-0">Risks</h3>
                <span className="text-xs text-text-muted">{risks.length} risks identified</span>
              </div>
              {risks.length === 0 ? (
                <div className="py-8 text-center">
                  <AlertTriangle className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                  <p className="text-sm text-text-muted">No risks identified yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {riskItems.map((risk) => (
                    <div key={risk.id} className="rounded-lg border border-status-warning/20 bg-status-warning/5 p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-text-muted">{risk.id}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                            risk.probability === 'high' ? 'bg-status-error/10 text-status-error'
                            : risk.probability === 'medium' ? 'bg-status-warning/10 text-status-warning'
                            : 'bg-status-info/10 text-status-info'
                          }`}>{risk.probability} probability</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                            risk.impact === 'high' ? 'bg-status-error/10 text-status-error'
                            : risk.impact === 'medium' ? 'bg-status-warning/10 text-status-warning'
                            : 'bg-status-info/10 text-status-info'
                          }`}>{risk.impact} impact</span>
                        </div>
                        <StatusBadge status={risk.status === 'mitigated' ? 'success' : 'warning'}>{risk.status}</StatusBadge>
                      </div>
                      <p className="text-sm font-medium text-text-primary mb-1">{risk.description}</p>
                      {risk.mitigation && (
                        <p className="text-xs text-text-secondary">
                          <span className="font-medium text-text-primary">Mitigation:</span> {risk.mitigation}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Dependencies tab */}
          {activeTab === 'dependencies' && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="section-title mb-0">Dependencies</h3>
                <span className="text-xs text-text-muted">{dependencies.length} dependencies</span>
              </div>
              {dependencies.length === 0 ? (
                <div className="py-8 text-center">
                  <GitBranch className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                  <p className="text-sm text-text-muted">No dependencies identified yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {dependencyItems.map((dep) => (
                    <div key={dep.id} className="rounded-lg bg-dark-bg p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-mono text-ey-yellow">{dep.id}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                              dep.criticality === 'high' ? 'bg-status-error/10 text-status-error'
                              : dep.criticality === 'medium' ? 'bg-status-warning/10 text-status-warning'
                              : 'bg-dark-border text-text-muted'
                            }`}>{dep.criticality}</span>
                          </div>
                          <p className="text-sm font-medium text-text-primary">{dep.name}</p>
                          <p className="text-xs text-text-secondary">{dep.description}</p>
                          <p className="text-[10px] text-text-muted mt-1">Type: {dep.type}</p>
                        </div>
                        <StatusBadge status={dep.status === 'confirmed' ? 'success' : 'pending'}>{dep.status}</StatusBadge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Acceptance Criteria tab */}
          {activeTab === 'acceptance' && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="section-title mb-0">Acceptance Criteria</h3>
                <span className="text-xs text-text-muted">{acceptanceCriteria.length} criteria</span>
              </div>
              {acceptanceCriteria.length === 0 ? (
                <div className="py-8 text-center">
                  <CheckCircle2 className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                  <p className="text-sm text-text-muted">No acceptance criteria defined yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {acceptanceCriteria.map((ac) => (
                    <div key={ac.id} className="rounded-lg bg-dark-bg p-3 flex items-start gap-3">
                      <div className="flex-shrink-0 mt-0.5">
                        {ac.testable ? (
                          <CheckCircle2 className="h-4 w-4 text-status-success" />
                        ) : (
                          <Clock className="h-4 w-4 text-text-muted" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-mono text-ey-yellow">{ac.id}</span>
                          <span className="text-[10px] text-text-muted">Req: {ac.requirementId}</span>
                        </div>
                        <p className="text-xs text-text-primary">{ac.description}</p>
                      </div>
                      <StatusBadge status={ac.status === 'passed' ? 'success' : ac.status === 'failed' ? 'error' : 'pending'}>
                        {ac.status}
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Roles & Traceability tab */}
          {activeTab === 'roles' && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="section-title mb-0">Roles & Traceability</h3>
                <span className="text-xs text-text-muted">{userRoles.length} roles · {traceability.length} traced · {errorScenarios.length} error scenarios</span>
              </div>
              {userRoles.length === 0 && traceability.length === 0 && errorScenarios.length === 0 ? (
                <div className="py-8 text-center">
                  <Boxes className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                  <p className="text-sm text-text-muted">No user roles or traceability data generated yet.</p>
                </div>
              ) : (
                <Accordion>
                  {userRoles.length > 0 && (
                    <AccordionItem title="User Roles" icon={Boxes} defaultOpen badge={<span className="text-[10px] text-text-muted">{userRoles.length}</span>}>
                      <div className="space-y-3">
                        {userRoles.map((role: any, i: number) => (
                          <div key={i} className="rounded-lg bg-dark-bg p-3">
                            <p className="text-sm font-medium text-text-primary">{role.name}</p>
                            {role.description && <p className="text-xs text-text-secondary mt-0.5">{role.description}</p>}
                            <div className="mt-2"><AccordionBulletList items={role.permissions} /></div>
                          </div>
                        ))}
                      </div>
                    </AccordionItem>
                  )}
                  {traceability.length > 0 && (
                    <AccordionItem title="Traceability Matrix" icon={GitBranch} badge={<span className="text-[10px] text-text-muted">{traceability.length}</span>}>
                      <div className="space-y-2">
                        {traceability.map((t: any, i: number) => (
                          <div key={i} className="rounded-lg bg-dark-bg p-3 text-xs">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-ey-yellow">{t.requirement_id}</span>
                              {t.source && <span className="text-text-muted">Source: {t.source}</span>}
                            </div>
                            {t.business_goal && <p className="text-text-secondary">{t.business_goal}</p>}
                            {t.related_requirements?.length > 0 && (
                              <p className="text-[10px] text-text-muted mt-1">Related: {t.related_requirements.join(', ')}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </AccordionItem>
                  )}
                  {errorScenarios.length > 0 && (
                    <AccordionItem title="Error Scenarios" icon={AlertTriangle} badge={<span className="text-[10px] text-text-muted">{errorScenarios.length}</span>}>
                      <div className="space-y-2">
                        {errorScenarios.map((e: any, i: number) => (
                          <div key={i} className="rounded-lg bg-dark-bg p-3 text-xs">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-ey-yellow">{e.requirement_id}</span>
                            </div>
                            <p className="text-text-primary">{e.scenario}</p>
                            {e.expected_behavior && <p className="text-text-secondary mt-1"><span className="text-text-primary font-medium">Expected:</span> {e.expected_behavior}</p>}
                          </div>
                        ))}
                      </div>
                    </AccordionItem>
                  )}
                </Accordion>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
// ─── Expandable requirement card with implementation-ready detail ─────────────

interface RequirementCardProps {
  req: Requirement;
  onEdit: () => void;
  editing: boolean;
  editValues: Partial<Requirement>;
  setEditValues: (v: Partial<Requirement>) => void;
  saveEdit: () => void;
  cancelEdit: () => void;
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-dark-surface/50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-3.5 w-3.5 text-ey-yellow" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{title}</span>
      </div>
      {children}
    </div>
  );
}

function BulletList({ items }: { items?: string[] }) {
  if (!items || items.length === 0) return <p className="text-[11px] text-text-muted">—</p>;
  return (
    <ul className="space-y-1">
      {items.map((it, i) => (
        <li key={i} className="text-[11px] text-text-secondary leading-relaxed flex gap-1.5">
          <span className="text-ey-yellow mt-0.5">•</span><span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

function RequirementCard({ req, onEdit, editing, editValues, setEditValues, saveEdit, cancelEdit }: RequirementCardProps) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!(req.business_rules?.length || req.acceptance_criteria?.length || req.validations?.length);

  if (editing) {
    return (
      <div className="rounded-lg bg-dark-bg p-3 space-y-2">
        <input className="input-field text-xs w-full" value={editValues.description || ''} onChange={(e) => setEditValues({ ...editValues, description: e.target.value })} />
        <div className="flex gap-2">
          <select className="input-field text-xs" value={editValues.priority || 'medium'} onChange={(e) => setEditValues({ ...editValues, priority: e.target.value })}>
            <option>low</option><option>medium</option><option>high</option><option>critical</option>
          </select>
          <button onClick={saveEdit} className="btn-ghost text-xs"><Save className="h-3 w-3" /> Save</button>
          <button onClick={cancelEdit} className="btn-ghost text-xs">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-dark-bg overflow-hidden">
      {/* Summary row */}
      <div className="flex items-start justify-between p-3 gap-2">
        <button onClick={() => hasDetail && setOpen(!open)} className="flex items-start gap-2 flex-1 text-left">
          {hasDetail ? (
            open ? <ChevronDown className="h-4 w-4 text-text-muted mt-0.5 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-text-muted mt-0.5 flex-shrink-0" />
          ) : <span className="w-4 flex-shrink-0" />}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-mono text-ey-yellow">{req.id}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                req.priority === 'critical' ? 'bg-status-error/10 text-status-error'
                : req.priority === 'high' ? 'bg-status-warning/10 text-status-warning'
                : 'bg-dark-border text-text-muted'
              }`}>{req.priority}</span>
              {req.risk_level && <span className="text-[10px] px-2 py-0.5 rounded-full bg-dark-border text-text-muted">risk: {req.risk_level}</span>}
              {hasDetail && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-ey-yellow/10 text-ey-yellow">spec</span>}
            </div>
            <p className="text-xs text-text-primary">{req.description}</p>
            <p className="text-[10px] text-text-muted mt-1">Category: {req.category} · Source: {req.source}</p>
          </div>
        </button>
        <button onClick={onEdit} className="p-1 rounded hover:bg-dark-surface text-text-muted hover:text-ey-yellow flex-shrink-0">
          <Edit3 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Expanded implementation-ready detail */}
      {open && hasDetail && (
        <div className="border-t border-dark-border p-3 grid gap-3 md:grid-cols-2">
          <Section icon={ShieldAlert} title="Business Rules"><BulletList items={req.business_rules} /></Section>
          <Section icon={ListChecks} title="Validations"><BulletList items={req.validations} /></Section>
          <Section icon={AlertTriangle} title="Edge Cases"><BulletList items={req.edge_cases} /></Section>
          <Section icon={Workflow} title="Workflow">
            <ol className="space-y-1 list-decimal list-inside">
              {(req.workflow || []).map((s, i) => <li key={i} className="text-[11px] text-text-secondary leading-relaxed">{s}</li>)}
            </ol>
          </Section>
          <Section icon={CheckCircle2} title="Acceptance Criteria">
            <div className="space-y-2">
              {(req.acceptance_criteria || []).map((ac, i) => (
                <div key={i} className="text-[11px] leading-relaxed">
                  <span className="text-status-success font-semibold">Given</span> <span className="text-text-secondary">{ac.given}</span>{' '}
                  <span className="text-status-info font-semibold">When</span> <span className="text-text-secondary">{ac.when}</span>{' '}
                  <span className="text-ey-yellow font-semibold">Then</span> <span className="text-text-secondary">{ac.then}</span>
                </div>
              ))}
            </div>
          </Section>
          <Section icon={Code2} title="API Considerations">
            <div className="space-y-1">
              {(req.api_considerations?.endpoints || []).map((ep, i) => (
                <div key={i} className="text-[11px] font-mono flex gap-2">
                  <span className={`font-semibold ${ep.method === 'GET' ? 'text-status-info' : ep.method === 'DELETE' ? 'text-status-error' : 'text-status-success'}`}>{ep.method}</span>
                  <span className="text-text-secondary">{ep.path}</span>
                </div>
              ))}
              <BulletList items={req.api_considerations?.notes} />
            </div>
          </Section>
          <Section icon={Boxes} title="UI Behavior"><BulletList items={req.ui_behavior} /></Section>
          <Section icon={Database} title="Database Impact">
            {req.db_impact?.primary_table && (
              <p className="text-[11px] text-text-secondary mb-1">Table: <span className="font-mono text-ey-yellow">{req.db_impact.primary_table}</span></p>
            )}
            {req.db_impact?.columns_touched && req.db_impact.columns_touched.length > 0 && (
              <p className="text-[10px] text-text-muted mb-1 font-mono">{req.db_impact.columns_touched.join(', ')}</p>
            )}
            <BulletList items={req.db_impact?.notes} />
          </Section>
          <Section icon={GitBranch} title="Dependencies"><BulletList items={req.dependencies} /></Section>
          <Section icon={Shield} title="Constraints"><BulletList items={req.constraints} /></Section>
          <Section icon={Zap} title="NFR Targets">
            <div className="space-y-1">
              {Object.entries(req.nfr_targets || {}).map(([k, v]) => (
                <p key={k} className="text-[11px] text-text-secondary"><span className="text-ey-yellow capitalize">{k}:</span> {v}</p>
              ))}
            </div>
          </Section>
          <Section icon={Lightbulb} title="Assumptions"><BulletList items={req.assumptions} /></Section>
        </div>
      )}
    </div>
  );
}
