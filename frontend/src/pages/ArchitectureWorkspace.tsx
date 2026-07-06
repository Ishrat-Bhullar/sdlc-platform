import { useState, useMemo, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Building2,
  Clock,
  CheckCircle2,
  ArrowDown,
  ArrowDownUp,
  Workflow,
  GitBranch,
  ThumbsUp,
  RefreshCw,
  Download,
  Server,
  Database,
  Cloud,
  Monitor,
  Globe,
  Layers,
  Box,
  FileCode,
  Eye,
  Copy,
  Check,
  AlertTriangle,
  Shield,
  Zap,
  Lightbulb,
  FileJson,
  FileType,
  FileText as FileTextIcon,
  File,
  Loader2,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar } from '../components/ui/Card';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { ArchitectureDiagramViewer, DiagramData, sanitizeMermaidSource } from '../components/ArchitectureDiagramViewer';
import { getSelectedProjectId } from '../lib/projectContext';
import { buildApiUrl, fastApiRequest } from '../lib/api';
import { useToast } from '../components/ui/Toast';
import type { Approval, ArchitectureContent } from '../types/unified';

export function ArchitectureWorkspace() {
  const [activeTab, setActiveTab] = useState<'system' | 'component' | 'sequence' | 'class' | 'er' | 'deployment' | 'dataflow' | 'infrastructure' | 'network' | 'decisions'>('system');
  const [showJsonViewer, setShowJsonViewer] = useState(false);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [architectureApproval, setArchitectureApproval] = useState<Approval | null>(null);
  const [approving, setApproving] = useState(false);
  const { addToast } = useToast();

  const projectId = getSelectedProjectId();
  const { getArchitecture, loading, error, reload, downloadArtifact } = useUnifiedArtifacts(projectId);

  const loadApproval = async () => {
    if (!projectId) { setArchitectureApproval(null); return; }
    try {
      const approvals = await fastApiRequest<Approval[]>(`/projects/${projectId}/approvals`);
      setArchitectureApproval(approvals.find((a) => a.artifact_type === 'architecture_diagram') || null);
    } catch (e) {
      console.error('Failed to load architecture approval status:', e);
      setArchitectureApproval(null);
    }
  };

  useEffect(() => {
    loadApproval();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleApproveArchitecture = async () => {
    if (!projectId || !architectureApproval) return;
    setApproving(true);
    try {
      await fastApiRequest(`/projects/${projectId}/approvals/${architectureApproval.id}/decide`, {
        method: 'POST',
        body: { decision: 'Approved' },
      });
      await loadApproval();
      addToast('Architecture approved', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to approve architecture', 'error');
    } finally {
      setApproving(false);
    }
  };

  const handleRegenerateDiagrams = async () => {
    if (!projectId) return;
    setRegenerating(true);
    try {
      await fastApiRequest('/generate/architecture-diagrams', {
        method: 'POST',
        body: { project_id: Number(projectId) },
      });
      await reload();
    } catch (e) {
      console.error('Diagram regeneration failed:', e);
    } finally {
      setRegenerating(false);
    }
  };

  const archData = getArchitecture();

  const architectureVersion = 'v1.0.0';
  const lastGenerated = new Date();

  const designDecisions = useMemo(() => {
    if (!archData?.architecture_decisions) return [] as any[];
    // Real backend shape has no per-decision approval state (these are
    // recorded ADR-style entries, not individually approved/pending) —
    // labeled 'recorded' rather than fabricating an approved/pending status.
    return archData.architecture_decisions.map((d, i) => ({
      id: i,
      title: d.decision,
      rationale: d.rationale,
      tradeoffs: d.consequences,
      status: 'recorded',
    }));
  }, [archData]);

  const techRecommendations = useMemo(() => {
    if (!archData?.tech_stack) return [];
    return Object.entries(archData.tech_stack).map(([category, tech]) => ({
      name: category,
      category: 'Technology',
      reason: typeof tech === 'string' ? tech : '',
    }));
  }, [archData]);

  const getComponentIcon = (type: string) => {
    switch (type) {
      case 'frontend': return Monitor;
      case 'api': return Globe;
      case 'service': return Server;
      case 'database': return Database;
      case 'external': return Cloud;
      default: return Box;
    }
  };

  const getComponentColor = (type: string) => {
    switch (type) {
      case 'frontend': return 'text-status-info bg-status-info/10 border-status-info';
      case 'api': return 'text-ey-yellow bg-ey-yellow/10 border-ey-yellow';
      case 'service': return 'text-status-success bg-status-success/10 border-status-success';
      case 'database': return 'text-purple-400 bg-purple-400/10 border-purple-400';
      case 'external': return 'text-text-muted bg-dark-bg border-dark-border-light';
      default: return 'text-text-secondary bg-dark-bg border-dark-border';
    }
  };

  const diagrams: DiagramData[] = useMemo(() => {
    if (!archData?.diagrams) return [];
    return archData.diagrams as DiagramData[];
  }, [archData]);

  const components = useMemo(() => {
    if (!archData?.components) return [];
    return archData.components as any[];
  }, [archData]);

  const handleCopyJson = () => {
    if (archData) {
      navigator.clipboard.writeText(JSON.stringify(archData, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadJson = () => {
    if (archData && projectId) {
      const blob = new Blob([JSON.stringify(archData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `architecture_${projectId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleExport = async (format: 'json' | 'md') => {
    if (!projectId) return;
    try {
      await downloadArtifact('architecture_diagram', format);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  const handleLegacyExport = async (format: string) => {
    if (!projectId) return;
    try {
      const url = buildApiUrl(`/documents/export-artifact?projectId=${projectId}&artifact_type=architecture_diagram&format=${format}`);
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `architecture_${projectId}.${format}`;
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
          <h1 className="text-2xl font-bold text-text-primary">Architecture Workspace</h1>
          <p className="mt-1 text-sm text-text-muted">Solution architecture designed by Architect Agent</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-dark-card px-3 py-1.5">
            <Clock className="h-4 w-4 text-text-muted" />
            <span className="text-xs text-text-muted">Last updated: {lastGenerated.toLocaleTimeString()}</span>
          </div>
          <span className="rounded-lg bg-ey-yellow/10 px-3 py-1.5 text-xs font-medium text-ey-yellow">
            {architectureVersion}
          </span>
          {architectureApproval?.status === 'Approved' ? (
            <StatusBadge status="success">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Approved
            </StatusBadge>
          ) : (
            <button
              className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleApproveArchitecture}
              disabled={approving || !architectureApproval}
              title={!architectureApproval ? 'No pending architecture approval for this project' : undefined}
            >
              <ThumbsUp className="mr-2 h-4 w-4" />
              {approving ? 'Approving…' : 'Approve Architecture'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <Card className="border-status-error/30 bg-status-error/5 text-sm text-status-error">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
            <button onClick={reload} className="ml-auto underline hover:no-underline">Retry</button>
          </div>
        </Card>
      )}

      {!archData ? (
        <Card className="py-10 text-center">
          <Building2 className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">No architecture generated yet</p>
          <p className="text-xs text-text-muted mt-1">Run the Architect Agent in the pipeline to generate architecture.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left & Center: Architecture Diagrams */}
            <div className="lg:col-span-2 space-y-6">
              {/* Tabs */}
              <div className="flex flex-wrap border-b border-dark-border">
                {[
                  { id: 'system', label: 'High-Level', icon: Workflow },
                  { id: 'component', label: 'Component', icon: Box },
                  { id: 'sequence', label: 'Sequence', icon: ArrowDownUp },
                  { id: 'class', label: 'Class', icon: FileCode },
                  { id: 'er', label: 'ER', icon: Database },
                  { id: 'deployment', label: 'Deployment', icon: Cloud },
                  { id: 'dataflow', label: 'Data Flow', icon: GitBranch },
                  { id: 'infrastructure', label: 'Infrastructure', icon: Server },
                  { id: 'network', label: 'Network', icon: Globe },
                  { id: 'decisions', label: 'Decisions', icon: Lightbulb },
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

              {/* Architecture Diagrams — unified Mermaid rendering */}
              {activeTab !== 'decisions' && (() => {
                const TYPE_MAP: Record<string, { keys: string[]; label: string }> = {
                  // Some `keys` entries cover multiple diagram-type vocabularies the
                  // architect agent has used over time — 'container' and 'workflow'
                  // are the current agent's C4-style/process-diagram type names,
                  // which previously had no matching tab at all (diagrams existed
                  // in the data but were unreachable in the UI).
                  system: { keys: ['high_level', 'system_context', 'system'], label: 'High-Level Architecture' },
                  component: { keys: ['component', 'container'], label: 'Component Diagram' },
                  sequence: { keys: ['sequence', 'sequence_login'], label: 'Sequence Diagram' },
                  class: { keys: ['class'], label: 'Class Diagram' },
                  er: { keys: ['er', 'erd', 'entity'], label: 'Entity Relationship Diagram' },
                  deployment: { keys: ['deployment'], label: 'Deployment Diagram' },
                  dataflow: { keys: ['dataflow', 'data_flow', 'workflow'], label: 'Data Flow Diagram' },
                  infrastructure: { keys: ['infrastructure', 'infra'], label: 'Infrastructure Diagram' },
                  network: { keys: ['network'], label: 'Network Diagram' },
                };
                const spec = TYPE_MAP[activeTab] || TYPE_MAP.system;
                const match = diagrams.find((d) => spec.keys.some((k) => (d.type || '').toLowerCase().includes(k)));
                return (
                  <Card className="min-h-[520px]">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="section-title mb-0">{match?.title || spec.label}</h3>
                      <div className="flex gap-2">
                        <button onClick={handleRegenerateDiagrams} disabled={regenerating} className="btn-ghost text-xs">
                          {regenerating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                          Regenerate All
                        </button>
                        <button onClick={() => setShowJsonViewer(!showJsonViewer)} className="btn-ghost text-xs">
                          <FileCode className="mr-1 h-3 w-3" />
                          {showJsonViewer ? 'Hide' : 'View'} Source
                        </button>
                      </div>
                    </div>
                    {match ? (
                      showJsonViewer ? (
                        <pre className="max-h-[440px] overflow-auto rounded-lg bg-dark-bg p-4 text-xs text-text-secondary">{match.content}</pre>
                      ) : (
                        <MermaidChart source={match.content} id={`arch-${activeTab}`} />
                      )
                    ) : (
                      <div className="flex flex-col items-center justify-center h-96 gap-3">
                        <p className="text-sm text-text-muted">No {spec.label} generated yet.</p>
                        <button onClick={handleRegenerateDiagrams} disabled={regenerating} className="btn-primary text-sm">
                          {regenerating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating…</> : <><RefreshCw className="mr-2 h-4 w-4" />Generate All Diagrams</>}
                        </button>
                      </div>
                    )}
                  </Card>
                );
              })()}

              {/* Legacy hidden block (kept for reference, never rendered) */}
              {false && activeTab === 'system' && (
                <Card className="h-[500px]">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="section-title mb-0">System Architecture</h3>
                    <div className="flex gap-2">
                      <button onClick={() => setShowJsonViewer(!showJsonViewer)} className="btn-ghost text-xs">
                        <FileCode className="mr-1 h-3 w-3" />
                        {showJsonViewer ? 'Hide' : 'View'} JSON
                      </button>
                    </div>
                  </div>
                  {showJsonViewer ? (
                    <div className="relative">
                      <pre className="max-h-96 overflow-auto rounded-lg bg-dark-bg p-4 text-xs text-text-secondary">
                        {JSON.stringify(archData, null, 2)}
                      </pre>
                      <button
                        onClick={handleCopyJson}
                        className="absolute top-2 right-2 p-2 rounded-lg bg-dark-surface hover:bg-dark-border text-text-muted hover:text-text-primary"
                        title="Copy JSON"
                      >
                        {copied ? <Check className="h-4 w-4 text-status-success" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center relative">
                      {/* Architecture Visualization */}
                      <div className="absolute inset-4 flex flex-col items-center justify-between">
                        {/* Frontend Layer */}
                        <div className="flex items-center gap-4">
                          {components.filter((c: any) => c.type === 'frontend').map((component: any) => {
                            const Icon = getComponentIcon(component.type);
                            const colorClass = getComponentColor(component.type);
                            return (
                              <motion.div
                                key={component.id ?? component.name}
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 ${colorClass}`}
                              >
                                <Icon className="h-8 w-8" />
                                <span className="text-xs font-medium">{component.name}</span>
                              </motion.div>
                            );
                          })}
                        </div>

                        <ArrowDown className="h-8 w-8 text-dark-border-light my-2" />

                        {/* API Gateway */}
                        <div className="flex items-center">
                          {components.filter((c: any) => c.type === 'api').map((component: any) => {
                            const Icon = getComponentIcon(component.type);
                            const colorClass = getComponentColor(component.type);
                            return (
                              <motion.div
                                key={component.id ?? component.name}
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className={`flex flex-col items-center gap-2 rounded-lg border-2 px-8 py-4 ${colorClass}`}
                              >
                                <Icon className="h-8 w-8" />
                                <span className="text-sm font-medium">{component.name}</span>
                              </motion.div>
                            );
                          })}
                        </div>

                        <ArrowDown className="h-8 w-8 text-dark-border-light my-2" />

                        {/* Services Layer */}
                        <div className="flex items-center gap-4 flex-wrap justify-center">
                          {components.filter((c: any) => c.type === 'service').map((component: any) => {
                            const Icon = getComponentIcon(component.type);
                            const colorClass = getComponentColor(component.type);
                            return (
                              <motion.div
                                key={component.id ?? component.name}
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: component.id === '3' ? 0.2 : 0.3 }}
                                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-3 min-w-[100px] ${colorClass}`}
                              >
                                <Icon className="h-6 w-6" />
                                <span className="text-xs font-medium text-center">{component.name}</span>
                              </motion.div>
                            );
                          })}
                        </div>

                        <ArrowDown className="h-8 w-8 text-dark-border-light my-2" />

                        {/* Database Layer */}
                        <div className="flex items-center gap-4">
                          {components.filter((c: any) => c.type === 'database').map((component: any) => {
                            const Icon = getComponentIcon(component.type);
                            const colorClass = getComponentColor(component.type);
                            return (
                              <motion.div
                                key={component.id ?? component.name}
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.4 }}
                                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-3 ${colorClass}`}
                              >
                                <Icon className="h-6 w-6" />
                                <span className="text-xs font-medium">{component.name}</span>
                              </motion.div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              )}

              {/* Sequence Diagram */}
              {false && activeTab === 'sequence' && (
                <Card className="h-[500px]">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="section-title mb-0">Sequence Diagram</h3>
                    <button onClick={() => setShowJsonViewer(!showJsonViewer)} className="btn-ghost text-xs">
                      <FileCode className="mr-1 h-3 w-3" />
                      {showJsonViewer ? 'Hide' : 'View'} JSON
                    </button>
                  </div>
                  {showJsonViewer ? (
                    <pre className="max-h-96 overflow-auto rounded-lg bg-dark-bg p-4 text-xs text-text-secondary">
                      {JSON.stringify(archData, null, 2)}
                    </pre>
                  ) : (
                    <div className="flex items-center justify-center h-96">
                      <p className="text-sm text-text-muted">Sequence diagram visualization</p>
                    </div>
                  )}
                </Card>
              )}

              {/* Component Diagram */}
              {false && activeTab === 'component' && (
                <Card className="h-[500px]">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="section-title mb-0">Component Diagram</h3>
                    <button onClick={() => setShowJsonViewer(!showJsonViewer)} className="btn-ghost text-xs">
                      <FileCode className="mr-1 h-3 w-3" />
                      {showJsonViewer ? 'Hide' : 'View'} JSON
                    </button>
                  </div>
                  {showJsonViewer ? (
                    <pre className="max-h-96 overflow-auto rounded-lg bg-dark-bg p-4 text-xs text-text-secondary">
                      {JSON.stringify(archData, null, 2)}
                    </pre>
                  ) : (
                    <div className="flex items-center justify-center h-96">
                      <p className="text-sm text-text-muted">Component diagram visualization</p>
                    </div>
                  )}
                </Card>
              )}

              {/* Deployment Diagram */}
              {false && activeTab === 'deployment' && (
                <Card className="h-[500px]">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="section-title mb-0">Deployment Diagram</h3>
                    <button onClick={() => setShowJsonViewer(!showJsonViewer)} className="btn-ghost text-xs">
                      <FileCode className="mr-1 h-3 w-3" />
                      {showJsonViewer ? 'Hide' : 'View'} JSON
                    </button>
                  </div>
                  {showJsonViewer ? (
                    <pre className="max-h-96 overflow-auto rounded-lg bg-dark-bg p-4 text-xs text-text-secondary">
                      {JSON.stringify(archData, null, 2)}
                    </pre>
                  ) : (
                    <div className="flex items-center justify-center h-96">
                      <p className="text-sm text-text-muted">Deployment diagram visualization</p>
                    </div>
                  )}
                </Card>
              )}

              {/* API Flows */}
              {false && (
                <Card className="h-[500px]">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="section-title mb-0">API Flows</h3>
                    <button onClick={() => setShowJsonViewer(!showJsonViewer)} className="btn-ghost text-xs">
                      <FileCode className="mr-1 h-3 w-3" />
                      {showJsonViewer ? 'Hide' : 'View'} JSON
                    </button>
                  </div>
                  {showJsonViewer ? (
                    <pre className="max-h-96 overflow-auto rounded-lg bg-dark-bg p-4 text-xs text-text-secondary">
                      {JSON.stringify(archData, null, 2)}
                    </pre>
                  ) : (
                    <div className="flex items-center justify-center h-96">
                      <p className="text-sm text-text-muted">API flow diagram visualization</p>
                    </div>
                  )}
                </Card>
              )}

              {/* Design Decisions */}
              {activeTab === 'decisions' && (
                <Card>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="section-title mb-0">Design Decisions</h3>
                    <span className="text-xs text-text-muted">{designDecisions.length} decisions</span>
                  </div>
                  <div className="space-y-3">
                    {designDecisions.map((decision) => (
                      <div key={decision.id} className="rounded-lg bg-dark-bg p-4">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="text-sm font-semibold text-text-primary">{decision.title}</h4>
                          <StatusBadge status="info">
                            {decision.status}
                          </StatusBadge>
                        </div>
                        <p className="text-xs text-text-secondary mb-2">{decision.rationale}</p>
                        <p className="text-[10px] text-text-muted">
                          <span className="font-medium">Tradeoffs:</span> {decision.tradeoffs}
                        </p>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Architecture Stats */}
              <div className="grid grid-cols-4 gap-4">
                <Card className="text-center">
                  <p className="text-2xl font-bold text-ey-yellow">{components.length}</p>
                  <p className="text-xs text-text-muted">Components</p>
                </Card>
                <Card className="text-center">
                  <p className="text-2xl font-bold text-status-success">{diagrams.length}</p>
                  <p className="text-xs text-text-muted">Diagrams</p>
                </Card>
                <Card className="text-center">
                  <p className="text-2xl font-bold text-status-info">{techRecommendations.length}</p>
                  <p className="text-xs text-text-muted">Technologies</p>
                </Card>
                <Card className="text-center">
                  <p className="text-2xl font-bold text-status-warning">{designDecisions.length}</p>
                  <p className="text-xs text-text-muted">Design Decisions</p>
                </Card>
              </div>
            </div>

            {/* Right Panel: Architect Agent Activity */}
            <div className="space-y-6">
              {/* Agent Status */}
              <Card glow>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ey-yellow/10">
                    <Building2 className="h-5 w-5 text-ey-yellow" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text-primary">Architect Agent</p>
                    <p className="text-xs text-text-muted">Designing microservices architecture</p>
                  </div>
                  <StatusBadge status="running">Active</StatusBadge>
                </div>
                <ProgressBar value={78} max={100} color="yellow" showLabel className="mt-4" />
              </Card>

              {/* Technology Stack */}
              <Card>
                <h3 className="section-title">Technology Stack</h3>
                <div className="space-y-2">
                  {techRecommendations.map((tech, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between rounded-lg bg-dark-bg p-2"
                    >
                      <div>
                        <p className="text-xs font-medium text-text-primary">{tech.name}</p>
                        <p className="text-[10px] text-text-muted">{tech.category}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-status-success" />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Trade-offs — real consequences pulled from architecture_decisions
                  (the agent's own ADR-style records), not fabricated scores */}
              <Card>
                <h3 className="section-title">Key Trade-offs</h3>
                {designDecisions.length === 0 ? (
                  <p className="text-xs text-text-muted">No architecture decisions recorded yet.</p>
                ) : (
                  <div className="space-y-3">
                    {designDecisions.slice(0, 3).map((decision) => (
                      <div key={decision.id}>
                        <p className="text-xs font-medium text-text-primary">{decision.title}</p>
                        <p className="text-[11px] text-text-muted mt-0.5">{decision.tradeoffs}</p>
                      </div>
                    ))}
                  </div>
                )}
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
          </div>

          {/* Architecture Diagrams Section */}
          {diagrams.length > 0 && (
            <ArchitectureDiagramViewer diagrams={diagrams} />
          )}
        </>
      )}
    </div>
  );
}
// ─── Reusable Mermaid renderer ────────────────────────────────────────────────

function MermaidChart({ source, id }: { source: string; id: string }) {
  const [svg, setSvg] = useState<string>('');
  const [err, setErr] = useState<string>('');
  const [rendering, setRendering] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRendering(true);
      setErr('');
      try {
        const mermaid = await import('mermaid');
        mermaid.default.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            primaryColor: '#2E2E38',
            primaryTextColor: '#f0f0f0',
            primaryBorderColor: '#FFE600',
            lineColor: '#FFE600',
            secondaryColor: '#1a1a24',
            tertiaryColor: '#3a3a48',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            fontSize: '15px',
          },
          securityLevel: 'loose',
          er: { useMaxWidth: true },
          sequence: { useMaxWidth: true },
          flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
        });
        const renderId = 'mmd-' + id + '-' + Math.random().toString(36).slice(2, 8);
        const { svg: out } = await mermaid.default.render(renderId, sanitizeMermaidSource(source));
        if (!cancelled) setSvg(out);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Failed to render diagram');
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => { cancelled = true; };
  }, [source, id]);

  const handleDownloadSvg = () => {
    const el = containerRef.current?.querySelector('svg');
    if (!el) return;
    const clone = el.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const str = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${id}.svg`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPng = () => {
    const el = containerRef.current?.querySelector('svg');
    if (!el) return;
    const str = new XMLSerializer().serializeToString(el);
    const img = new window.Image();
    const svgBlob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 2;
      canvas.width = (img.width || 900) * scale;
      canvas.height = (img.height || 600) * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#1a1a24';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const purl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = purl; a.download = `${id}.png`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(purl);
      }, 'image/png');
    };
    img.src = url;
  };

  if (rendering) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-6 w-6 animate-spin text-ey-yellow" />
      </div>
    );
  }
  if (err) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-2 text-center px-6">
        <AlertTriangle className="h-6 w-6 text-status-error" />
        <p className="text-sm text-status-error">Diagram failed to render</p>
        <pre className="text-[10px] text-text-muted max-h-40 overflow-auto bg-dark-bg rounded p-3 w-full text-left">{source}</pre>
      </div>
    );
  }
  return (
    <div>
      <div className="flex justify-end gap-2 mb-2">
        <button onClick={handleDownloadPng} className="btn-ghost text-xs"><Download className="mr-1 h-3 w-3" />PNG</button>
        <button onClick={handleDownloadSvg} className="btn-ghost text-xs"><Download className="mr-1 h-3 w-3" />SVG</button>
      </div>
      <div
        ref={containerRef}
        className="overflow-auto rounded-lg bg-dark-bg p-4 flex items-center justify-center min-h-[400px]"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
