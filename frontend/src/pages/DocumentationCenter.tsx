import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  FileSearch,
  Building2,
  Code2,
  Shield,
  Rocket,
  ClipboardCheck,
  Download,
  ExternalLink,
  Folder,
  ChevronRight,
  ChevronDown,
  Eye,
  Clock,
  CheckCircle2,
  Search,
  Database,
  Presentation,
  Video,
  Package,
  Loader2,
  AlertCircle,
  Edit3,
  Save,
  X,
  History,
  FileJson,
  FileType,
  FileText as FileTextIcon,
  File,
  Plus,
  Trash2,
  Copy,
  Check,
  RefreshCw,
} from 'lucide-react';
import { Card, StatusBadge } from '../components/ui/Card';
import { useProjectArtifacts, RawArtifact } from '../lib/useProjectArtifacts';
import { apiRequest, buildApiUrl, fastApiRequest } from '../lib/api';
import { getSelectedProjectId } from '../lib/projectContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  requirements_doc: 'Requirements',
  brd_document: 'Business Requirements Document',
  srs_document: 'System Requirements Specification',
  technical_documentation: 'Technical Documentation',
  user_stories: 'User Stories',
  architecture_diagram: 'Architecture',
  sql_schema: 'Database Schema',
  api_design: 'API Design',
  uiux_design: 'UI/UX Design',
  security_report: 'Security Report',
  compliance_report: 'Compliance Report',
  presentation: 'Presentation',
  presentation_pptx: 'PPTX',
  documentation: 'Documentation',
  test_report: 'Test Report',
  deployment_doc: 'Deployment Doc',
};

const ARTIFACT_TYPE_ICONS: Record<string, React.ReactNode> = {
  requirements_doc: <FileSearch className="h-4 w-4" />,
  brd_document: <FileSearch className="h-4 w-4" />,
  srs_document: <FileText className="h-4 w-4" />,
  technical_documentation: <FileText className="h-4 w-4" />,
  user_stories: <FileText className="h-4 w-4" />,
  architecture_diagram: <Building2 className="h-4 w-4" />,
  sql_schema: <Database className="h-4 w-4" />,
  api_design: <Code2 className="h-4 w-4" />,
  uiux_design: <FileText className="h-4 w-4" />,
  security_report: <Shield className="h-4 w-4" />,
  compliance_report: <Shield className="h-4 w-4" />,
  presentation: <Presentation className="h-4 w-4" />,
  presentation_pptx: <Presentation className="h-4 w-4" />,
  documentation: <FileText className="h-4 w-4" />,
  test_report: <ClipboardCheck className="h-4 w-4" />,
};

const ARTIFACT_TYPE_TO_SECTION: Record<string, string> = {
  requirements_doc: 'brd',
  brd_document: 'brd',
  srs_document: 'srs',
  technical_documentation: 'techdoc',
  user_stories: 'user-stories',
  architecture_diagram: 'architecture',
  sql_schema: 'database',
  api_design: 'api',
  uiux_design: 'uiux',
  security_report: 'security-reports',
  compliance_report: 'compliance',
  presentation: 'presentation',
  presentation_pptx: 'presentation',
  documentation: 'documentation',
  test_report: 'test-reports',
  deployment_doc: 'deployment-reports',
};

interface DocSection {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  artifactTypes: string[];
}

const docSections: DocSection[] = [
  { id: 'brd', name: 'BRD', icon: FileSearch, color: 'text-status-info bg-status-info/10', artifactTypes: ['requirements_doc', 'brd_document'] },
  { id: 'srs', name: 'SRS', icon: FileTextIcon, color: 'text-purple-400 bg-purple-400/10', artifactTypes: ['srs_document'] },
  { id: 'techdoc', name: 'Technical Docs', icon: FileTextIcon, color: 'text-ey-yellow bg-ey-yellow/10', artifactTypes: ['technical_documentation'] },
  { id: 'user-stories', name: 'User Stories', icon: FileText, color: 'text-status-success bg-status-success/10', artifactTypes: ['user_stories'] },
  { id: 'architecture', name: 'Architecture', icon: Building2, color: 'text-status-success bg-status-success/10', artifactTypes: ['architecture_diagram'] },
  { id: 'database', name: 'Database', icon: Database, color: 'text-purple-400 bg-purple-400/10', artifactTypes: ['sql_schema'] },
  { id: 'api', name: 'API Docs', icon: Code2, color: 'text-status-info bg-status-info/10', artifactTypes: ['api_design'] },
  { id: 'uiux', name: 'UI/UX', icon: FileText, color: 'text-ey-yellow bg-ey-yellow/10', artifactTypes: ['uiux_design'] },
  { id: 'security-reports', name: 'Security', icon: Shield, color: 'text-status-error bg-status-error/10', artifactTypes: ['security_report'] },
  { id: 'compliance', name: 'Compliance', icon: Shield, color: 'text-status-warning bg-status-warning/10', artifactTypes: ['compliance_report'] },
  { id: 'presentation', name: 'Presentation', icon: Presentation, color: 'text-ey-yellow bg-ey-yellow/10', artifactTypes: ['presentation', 'presentation_pptx'] },
  { id: 'documentation', name: 'Documentation', icon: FileText, color: 'text-status-info bg-status-info/10', artifactTypes: ['documentation'] },
  { id: 'test-reports', name: 'Test Reports', icon: ClipboardCheck, color: 'text-status-warning bg-status-warning/10', artifactTypes: ['test_report'] },
  { id: 'deployment-reports', name: 'Deployment', icon: Rocket, color: 'text-ey-yellow bg-ey-yellow/10', artifactTypes: ['deployment_doc'] },
];

// ─── Document Viewer Modal ────────────────────────────────────────────────────

interface DocumentViewerProps {
  artifact: RawArtifact;
  onClose: () => void;
  onUpdate: (id: number, content: Record<string, unknown>) => void;
}

function DocumentViewer({ artifact, onClose, onUpdate }: DocumentViewerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<any[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const content = useMemo(() => {
    try {
      return typeof artifact.content === 'string' ? JSON.parse(artifact.content) : artifact.content;
    } catch {
      return { raw_text: typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content) };
    }
  }, [artifact.content]);

  const label = ARTIFACT_TYPE_LABELS[artifact.artifact_type] || artifact.artifact_type;

  const loadVersions = useCallback(async () => {
    setLoadingVersions(true);
    try {
      const projectId = getSelectedProjectId();
      const data = await apiRequest<any[]>(`/generated_artifacts?project_id=${projectId}&artifact_type=${artifact.artifact_type}`);
      setVersions(data || []);
    } catch {
      setVersions([]);
    } finally {
      setLoadingVersions(false);
    }
  }, [artifact.artifact_type]);

  const handleEdit = () => {
    setEditedContent(JSON.stringify(content, null, 2));
    setIsEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(editedContent);
      await onUpdate(artifact.id, parsed);
      setIsEditing(false);
    } catch (e) {
      alert('Invalid JSON: ' + (e instanceof Error ? e.message : 'Parse error'));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedContent('');
  };

  const handleExport = async (format: 'json' | 'md' | 'pdf' | 'docx') => {
    try {
      const projectId = getSelectedProjectId();
      const url = buildApiUrl(`/documents/export-artifact?projectId=${projectId}&artifact_type=${artifact.artifact_type}&format=${format}`);
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${label.replace(/\s+/g, '_')}_${artifact.id}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      alert('Export failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
    }
  };

  const handleCopyRaw = () => {
    navigator.clipboard.writeText(JSON.stringify(content, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderFormattedContent = () => {
    if (artifact.artifact_type === 'requirements_doc') {
      const reqs = (content as any).functional || [];
      const nonFunctional = (content as any).nonFunctional || [];
      return (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-text-primary mb-3">Functional Requirements</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-border">
                    <th className="text-left py-2 px-3 text-text-muted font-medium">ID</th>
                    <th className="text-left py-2 px-3 text-text-muted font-medium">Description</th>
                    <th className="text-left py-2 px-3 text-text-muted font-medium">Priority</th>
                    <th className="text-left py-2 px-3 text-text-muted font-medium">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {reqs.map((req: any, i: number) => (
                    <tr key={i} className="border-b border-dark-border-light hover:bg-dark-bg">
                      <td className="py-2 px-3 font-mono text-xs text-ey-yellow">{req.id || `REQ-${i + 1}`}</td>
                      <td className="py-2 px-3 text-text-primary">{req.description}</td>
                      <td className="py-2 px-3">
                        <span className={`px-2 py-1 rounded text-xs ${
                          req.priority === 'high' ? 'bg-status-error/20 text-status-error' :
                          req.priority === 'medium' ? 'bg-status-warning/20 text-status-warning' :
                          'bg-status-success/20 text-status-success'
                        }`}>{req.priority}</span>
                      </td>
                      <td className="py-2 px-3 text-text-muted">{req.risk_level || 'low'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {nonFunctional.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-text-primary mb-3">Non-Functional Requirements</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-dark-border">
                      <th className="text-left py-2 px-3 text-text-muted font-medium">ID</th>
                      <th className="text-left py-2 px-3 text-text-muted font-medium">Description</th>
                      <th className="text-left py-2 px-3 text-text-muted font-medium">Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nonFunctional.map((req: any, i: number) => (
                      <tr key={i} className="border-b border-dark-border-light hover:bg-dark-bg">
                        <td className="py-2 px-3 font-mono text-xs text-ey-yellow">{req.id || `NFR-${i + 1}`}</td>
                        <td className="py-2 px-3 text-text-primary">{req.description}</td>
                        <td className="py-2 px-3">{req.priority}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (artifact.artifact_type === 'brd_document') {
      const doc = content as any;
      return (
        <div className="space-y-6">
          {/* Meta */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Version', value: doc.version },
              { label: 'Status', value: doc.status },
              { label: 'Date', value: doc.date },
              { label: 'Classification', value: doc.classification },
            ].map((m) => (
              <div key={m.label} className="p-3 rounded-lg bg-dark-bg border border-dark-border text-center">
                <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">{m.label}</p>
                <p className="text-xs font-semibold text-text-primary">{m.value}</p>
              </div>
            ))}
          </div>

          {/* Executive Summary */}
          {doc.executive_summary && (
            <div className="p-4 rounded-lg bg-status-info/5 border border-status-info/20">
              <h3 className="text-sm font-semibold text-status-info mb-2">Executive Summary</h3>
              <p className="text-sm text-text-muted leading-relaxed">{doc.executive_summary.overview}</p>
              {doc.executive_summary.key_objectives?.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-text-secondary mb-1">Key Objectives</p>
                  <ul className="space-y-1">{doc.executive_summary.key_objectives.map((o: string, i: number) => (
                    <li key={i} className="flex gap-2 text-xs text-text-muted"><span className="text-ey-yellow mt-0.5">→</span>{o}</li>
                  ))}</ul>
                </div>
              )}
            </div>
          )}

          {/* Scope */}
          {doc.scope && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-dark-bg border border-dark-border">
                <h4 className="text-xs font-semibold text-status-success mb-2 uppercase tracking-wide">In Scope</h4>
                <ul className="space-y-1">{doc.scope.in_scope?.map((s: string, i: number) => (
                  <li key={i} className="flex gap-2 text-xs text-text-muted"><CheckCircle2 className="h-3 w-3 text-status-success mt-0.5 flex-shrink-0" />{s}</li>
                ))}</ul>
              </div>
              <div className="p-4 rounded-lg bg-dark-bg border border-dark-border">
                <h4 className="text-xs font-semibold text-status-error mb-2 uppercase tracking-wide">Out of Scope</h4>
                <ul className="space-y-1">{doc.scope.out_of_scope?.map((s: string, i: number) => (
                  <li key={i} className="flex gap-2 text-xs text-text-muted"><X className="h-3 w-3 text-status-error mt-0.5 flex-shrink-0" />{s}</li>
                ))}</ul>
              </div>
            </div>
          )}

          {/* Functional Requirements */}
          {doc.functional_requirements?.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Functional Requirements</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-dark-border">
                    {['ID','Description','Category','Priority','Acceptance Criteria'].map(h => (
                      <th key={h} className="text-left py-2 px-3 text-text-muted font-medium">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>{doc.functional_requirements.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-dark-border-light hover:bg-dark-bg">
                      <td className="py-2 px-3 font-mono text-ey-yellow whitespace-nowrap">{r.id}</td>
                      <td className="py-2 px-3 text-text-primary">{r.description}</td>
                      <td className="py-2 px-3 text-text-muted">{r.category}</td>
                      <td className="py-2 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${r.priority==='Critical'?'bg-status-error/20 text-status-error':r.priority==='High'?'bg-status-warning/20 text-status-warning':'bg-status-success/20 text-status-success'}`}>{r.priority}</span>
                      </td>
                      <td className="py-2 px-3 text-text-muted max-w-xs">{r.acceptance_criteria}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* Risks */}
          {doc.risks?.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Risks &amp; Mitigations</h3>
              <div className="space-y-2">{doc.risks.map((r: any, i: number) => (
                <div key={i} className="p-3 rounded-lg bg-status-warning/5 border border-status-warning/20">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-text-primary">{r.id} — {r.description}</p>
                    <span className={`px-2 py-0.5 rounded text-[10px] whitespace-nowrap ${r.impact==='Critical'||r.impact==='High'?'bg-status-error/20 text-status-error':'bg-status-warning/20 text-status-warning'}`}>{r.impact}</span>
                  </div>
                  <p className="text-xs text-text-muted mt-1">{r.mitigation}</p>
                </div>
              ))}</div>
            </div>
          )}

          {/* Success Metrics */}
          {doc.executive_summary?.success_metrics?.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Success Metrics</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-dark-border">
                    {['Metric','Target','Measurement'].map(h => (
                      <th key={h} className="text-left py-2 px-3 text-text-muted font-medium">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>{doc.executive_summary.success_metrics.map((m: any, i: number) => (
                    <tr key={i} className="border-b border-dark-border-light">
                      <td className="py-2 px-3 text-text-primary">{m.metric}</td>
                      <td className="py-2 px-3 font-semibold text-ey-yellow">{m.target}</td>
                      <td className="py-2 px-3 text-text-muted">{m.measurement}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* Assumptions */}
          {doc.assumptions?.length > 0 && (
            <div className="p-4 rounded-lg bg-dark-bg border border-dark-border">
              <h3 className="text-sm font-semibold text-text-primary mb-2">Assumptions</h3>
              <ul className="space-y-1">{doc.assumptions.map((a: string, i: number) => (
                <li key={i} className="flex gap-2 text-xs text-text-muted"><span className="text-ey-yellow">•</span>{a}</li>
              ))}</ul>
            </div>
          )}
        </div>
      );
    }

    if (artifact.artifact_type === 'srs_document') {
      const doc = content as any;
      const nfr = doc.non_functional_requirements || {};
      return (
        <div className="space-y-6">
          {/* Meta */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Version', value: doc.version },
              { label: 'Status', value: doc.status },
              { label: 'Date', value: doc.date },
              { label: 'Classification', value: doc.classification },
            ].map((m) => (
              <div key={m.label} className="p-3 rounded-lg bg-dark-bg border border-dark-border text-center">
                <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">{m.label}</p>
                <p className="text-xs font-semibold text-text-primary">{m.value}</p>
              </div>
            ))}
          </div>

          {/* System Overview */}
          {doc.system_overview && (
            <div className="p-4 rounded-lg bg-purple-400/5 border border-purple-400/20">
              <h3 className="text-sm font-semibold text-purple-400 mb-2">System Overview</h3>
              <p className="text-sm text-text-muted leading-relaxed mb-3">{doc.system_overview.description}</p>
              {doc.system_overview.technology_stack && (
                <div>
                  <p className="text-xs font-medium text-text-secondary mb-2">Technology Stack</p>
                  <div className="flex flex-wrap gap-2">{Object.entries(doc.system_overview.technology_stack).map(([k, v]) => (
                    <span key={k} className="px-2 py-1 rounded bg-purple-400/10 text-purple-400 text-[10px]"><span className="font-semibold">{k}:</span> {String(v)}</span>
                  ))}</div>
                </div>
              )}
            </div>
          )}

          {/* Functional Requirements */}
          {doc.functional_requirements?.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Functional Requirements</h3>
              <div className="space-y-2">{doc.functional_requirements.map((r: any, i: number) => (
                <div key={i} className="p-3 rounded-lg bg-dark-bg border border-dark-border">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-mono text-xs text-ey-yellow">{r.id}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] ${r.priority==='Critical'?'bg-status-error/20 text-status-error':r.priority==='High'?'bg-status-warning/20 text-status-warning':'bg-status-success/20 text-status-success'}`}>{r.priority}</span>
                  </div>
                  <p className="text-xs text-text-primary mb-1">{r.description}</p>
                  <p className="text-[10px] text-text-muted italic">{r.system_response}</p>
                </div>
              ))}</div>
            </div>
          )}

          {/* NFR */}
          {(nfr.performance || nfr.availability || nfr.security) && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Non-Functional Requirements</h3>
              <div className="grid md:grid-cols-2 gap-4">
                {nfr.performance && (
                  <div className="p-3 rounded-lg bg-dark-bg border border-dark-border">
                    <h4 className="text-xs font-semibold text-status-info mb-2">Performance</h4>
                    {Object.entries(nfr.performance).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs py-0.5 border-b border-dark-border-light last:border-0">
                        <span className="text-text-muted">{k.replace(/_/g,' ')}</span>
                        <span className="text-text-primary font-medium">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {nfr.availability && (
                  <div className="p-3 rounded-lg bg-dark-bg border border-dark-border">
                    <h4 className="text-xs font-semibold text-status-success mb-2">Availability</h4>
                    {Object.entries(nfr.availability).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs py-0.5 border-b border-dark-border-light last:border-0">
                        <span className="text-text-muted">{k.replace(/_/g,' ')}</span>
                        <span className="text-text-primary font-medium">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {nfr.security && (
                  <div className="p-3 rounded-lg bg-dark-bg border border-dark-border">
                    <h4 className="text-xs font-semibold text-status-error mb-2">Security</h4>
                    {Object.entries(nfr.security).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs py-0.5 border-b border-dark-border-light last:border-0">
                        <span className="text-text-muted">{k.replace(/_/g,' ')}</span>
                        <span className="text-text-primary font-medium">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {nfr.scalability && (
                  <div className="p-3 rounded-lg bg-dark-bg border border-dark-border">
                    <h4 className="text-xs font-semibold text-ey-yellow mb-2">Scalability</h4>
                    {Object.entries(nfr.scalability).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs py-0.5 border-b border-dark-border-light last:border-0">
                        <span className="text-text-muted">{k.replace(/_/g,' ')}</span>
                        <span className="text-text-primary font-medium">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* API */}
          {doc.api_specification?.endpoints?.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">API Specification</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-dark-border">
                    {['Method','Path','Description','Auth','Responses'].map(h => (
                      <th key={h} className="text-left py-2 px-3 text-text-muted font-medium">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>{doc.api_specification.endpoints.map((ep: any, i: number) => (
                    <tr key={i} className="border-b border-dark-border-light hover:bg-dark-bg">
                      <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded font-mono text-[10px] ${ep.method==='GET'?'bg-status-success/20 text-status-success':ep.method==='POST'?'bg-status-info/20 text-status-info':ep.method==='PUT'?'bg-status-warning/20 text-status-warning':'bg-status-error/20 text-status-error'}`}>{ep.method}</span></td>
                      <td className="py-2 px-3 font-mono text-text-muted">{ep.path}</td>
                      <td className="py-2 px-3 text-text-primary">{ep.description}</td>
                      <td className="py-2 px-3 text-center">{ep.auth_required ? <CheckCircle2 className="h-3 w-3 text-status-success inline" /> : <X className="h-3 w-3 text-text-muted inline" />}</td>
                      <td className="py-2 px-3 text-text-muted">{(ep.response_codes || []).join(', ')}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* Acceptance Criteria */}
          {doc.acceptance_criteria?.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Acceptance Criteria</h3>
              <div className="space-y-2">{doc.acceptance_criteria.map((ac: any, i: number) => (
                <div key={i} className="p-3 rounded-lg bg-dark-bg border border-dark-border flex gap-3">
                  <span className="font-mono text-[10px] text-ey-yellow mt-0.5 whitespace-nowrap">{ac.id}</span>
                  <div>
                    <p className="text-xs font-medium text-text-primary mb-0.5">{ac.requirement}</p>
                    <p className="text-xs text-text-muted">{ac.criteria}</p>
                  </div>
                </div>
              ))}</div>
            </div>
          )}

          {/* Traceability */}
          {doc.traceability_matrix?.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Traceability Matrix</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-dark-border">
                    {['BRD Req','SRS Req','Test Case','Status'].map(h => (
                      <th key={h} className="text-left py-2 px-3 text-text-muted font-medium">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>{doc.traceability_matrix.map((row: any, i: number) => (
                    <tr key={i} className="border-b border-dark-border-light">
                      <td className="py-2 px-3 font-mono text-ey-yellow">{row.brd_req}</td>
                      <td className="py-2 px-3 font-mono text-purple-400">{row.srs_req}</td>
                      <td className="py-2 px-3 font-mono text-text-muted">{row.test_case}</td>
                      <td className="py-2 px-3"><span className="px-2 py-0.5 rounded text-[10px] bg-status-success/20 text-status-success">{row.status}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (artifact.artifact_type === 'technical_documentation') {
      return <TechnicalDocView doc={content as any} />;
    }

    if (artifact.artifact_type === 'user_stories') {
      const stories = (content as any).stories || [];
      const epics = (content as any).epics || [];
      return (
        <div className="space-y-6">
          {epics.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-text-primary mb-3">Epics</h3>
              <div className="space-y-2">
                {epics.map((epic: any, i: number) => (
                  <div key={i} className="p-3 rounded-lg bg-dark-bg border border-dark-border">
                    <p className="font-medium text-text-primary">{epic.title}</p>
                    <p className="text-sm text-text-muted mt-1">{epic.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <h3 className="text-lg font-semibold text-text-primary mb-3">User Stories</h3>
            <div className="space-y-3">
              {stories.map((story: any, i: number) => (
                <div key={i} className="p-4 rounded-lg bg-dark-bg border border-dark-border">
                  <div className="flex items-start justify-between mb-2">
                    <p className="font-medium text-text-primary">{story.title}</p>
                    <span className="text-xs text-text-muted">{story.storyId || `US-${i + 1}`}</span>
                  </div>
                  <p className="text-sm text-text-muted mb-3">{story.description}</p>
                  {story.acceptanceCriteria && story.acceptanceCriteria.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-medium text-text-secondary mb-1">Acceptance Criteria:</p>
                      <ul className="list-disc list-inside text-sm text-text-muted space-y-1">
                        {story.acceptanceCriteria.map((ac: string, j: number) => (
                          <li key={j}>{ac}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (artifact.artifact_type === 'architecture_diagram') {
      return (
        <div className="space-y-4">
          {(content as any).summary && (
            <div className="p-4 rounded-lg bg-dark-bg border border-dark-border">
              <h3 className="text-lg font-semibold text-text-primary mb-2">Architecture Summary</h3>
              <p className="text-sm text-text-muted">{(content as any).summary}</p>
            </div>
          )}
          {(content as any).tech_stack && (
            <div>
              <h3 className="text-lg font-semibold text-text-primary mb-2">Technology Stack</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries((content as any).tech_stack as Record<string, string>).map(([category, tech]) => (
                  <span key={category} className="px-3 py-1 rounded-full bg-ey-yellow/10 text-ey-yellow text-xs">
                    <span className="text-text-muted">{category}:</span> {tech}
                  </span>
                ))}
              </div>
            </div>
          )}
          {(content as any).diagrams && (
            <div>
              <h3 className="text-lg font-semibold text-text-primary mb-2">Diagrams</h3>
              <pre className="p-4 rounded-lg bg-dark-bg border border-dark-border text-xs text-text-muted overflow-x-auto">
                {JSON.stringify((content as any).diagrams, null, 2)}
              </pre>
            </div>
          )}
        </div>
      );
    }

    if (artifact.artifact_type === 'security_report' || artifact.artifact_type === 'compliance_report') {
      return (
        <div className="space-y-4">
          {(content as any).summary && (
            <div className="p-4 rounded-lg bg-dark-bg border border-dark-border">
              <h3 className="text-lg font-semibold text-text-primary mb-2">Summary</h3>
              <p className="text-sm text-text-muted">{(content as any).summary}</p>
            </div>
          )}
          {(content as any).findings && (
            <div>
              <h3 className="text-lg font-semibold text-text-primary mb-2">Findings</h3>
              <div className="space-y-2">
                {(content as any).findings.map((finding: any, i: number) => (
                  <div key={i} className="p-3 rounded-lg bg-dark-bg border border-dark-border">
                    <p className="text-sm text-text-primary">{finding.description || finding}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    if (artifact.artifact_type === 'sql_schema') {
      return (
        <div className="space-y-4">
          {(content as any).tables && (
            <div>
              <h3 className="text-lg font-semibold text-text-primary mb-2">Tables</h3>
              <div className="space-y-3">
                {(content as any).tables.map((table: any, i: number) => (
                  <div key={i} className="p-4 rounded-lg bg-dark-bg border border-dark-border">
                    <p className="font-mono text-sm text-ey-yellow mb-2">{table.name}</p>
                    {table.columns && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-dark-border">
                              <th className="text-left py-1 px-2 text-text-muted">Column</th>
                              <th className="text-left py-1 px-2 text-text-muted">Type</th>
                              <th className="text-left py-1 px-2 text-text-muted">Constraints</th>
                            </tr>
                          </thead>
                          <tbody>
                            {table.columns.map((col: any, j: number) => (
                              <tr key={j} className="border-b border-dark-border-light">
                                <td className="py-1 px-2 font-mono text-xs">{col.name}</td>
                                <td className="py-1 px-2 text-text-muted text-xs">{col.type}</td>
                                <td className="py-1 px-2 text-text-muted text-xs">{col.constraints || ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Default: render as formatted JSON
    return (
      <pre className="p-4 rounded-lg bg-dark-bg border border-dark-border text-xs text-text-muted overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(content, null, 2)}
      </pre>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-dark-card border border-dark-border rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-dark-border">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-ey-yellow" />
            <div>
              <h2 className="text-lg font-semibold text-text-primary">{label}</h2>
              <p className="text-xs text-text-muted">Created {new Date(artifact.created_at).toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowVersions(!showVersions)}
              className="btn-ghost text-xs"
            >
              <History className="mr-1 h-3 w-3" />
              Versions
            </button>
            <button
              onClick={handleCopyRaw}
              className="btn-ghost text-xs"
            >
              {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
              {copied ? 'Copied' : 'Copy Raw'}
            </button>
            {!isEditing ? (
              <button onClick={handleEdit} className="btn-ghost text-xs">
                <Edit3 className="mr-1 h-3 w-3" />
                Edit
              </button>
            ) : (
              <>
                <button onClick={handleSave} disabled={saving} className="btn-primary text-xs">
                  {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
                  Save
                </button>
                <button onClick={handleCancel} className="btn-ghost text-xs">
                  <X className="mr-1 h-3 w-3" />
                  Cancel
                </button>
              </>
            )}
            <button onClick={onClose} className="btn-ghost text-xs">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isEditing ? (
            <textarea
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              className="w-full h-full min-h-[400px] p-4 rounded-lg bg-dark-bg border border-dark-border font-mono text-xs text-text-primary resize-none focus:outline-none focus:border-ey-yellow"
              spellCheck={false}
            />
          ) : (
            renderFormattedContent()
          )}
        </div>

        {/* Footer - Export Options */}
        <div className="flex items-center justify-between p-4 border-t border-dark-border bg-dark-bg/50">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Export as:</span>
            <button onClick={() => handleExport('json')} className="btn-ghost text-xs">
              <FileJson className="mr-1 h-3 w-3" />
              JSON
            </button>
            <button onClick={() => handleExport('md')} className="btn-ghost text-xs">
              <FileType className="mr-1 h-3 w-3" />
              Markdown
            </button>
            <button onClick={() => handleExport('pdf')} className="btn-ghost text-xs">
              <FileTextIcon className="mr-1 h-3 w-3" />
              PDF
            </button>
            <button onClick={() => handleExport('docx')} className="btn-ghost text-xs">
              <File className="mr-1 h-3 w-3" />
              DOCX
            </button>
          </div>
          <button onClick={onClose} className="btn-secondary text-xs">
            Close
          </button>
        </div>

        {/* Versions Panel */}
        <AnimatePresence>
          {showVersions && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-dark-border overflow-hidden"
            >
              <div className="p-4 bg-dark-bg">
                <h3 className="text-sm font-semibold text-text-primary mb-3">Version History</h3>
                {loadingVersions ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-ey-yellow" />
                  </div>
                ) : versions.length > 0 ? (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {versions.map((v, i) => (
                      <div key={v.id || i} className="flex items-center justify-between p-2 rounded bg-dark-card border border-dark-border">
                        <div className="flex items-center gap-2">
                          <Clock className="h-3 w-3 text-text-muted" />
                          <span className="text-xs text-text-primary">Version {versions.length - i}</span>
                          <span className="text-xs text-text-muted">{new Date(v.created_at).toLocaleString()}</span>
                        </div>
                        <span className="text-xs text-text-muted">{(JSON.stringify(v.content || {}).length / 1024).toFixed(1)} KB</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-text-muted text-center py-4">No version history available</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function DocumentationCenter() {
  const [selectedSection, setSelectedSection] = useState<string | null>('architecture');
  const projectId = getSelectedProjectId();
  const { artifacts, loading, error, reload } = useProjectArtifacts(projectId);
  const [searchQuery, setSearchQuery] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [selectedArtifact, setSelectedArtifact] = useState<RawArtifact | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [generating, setGenerating] = useState<string | null>(null);

  const handleGenerateDoc = useCallback(async (docType: 'brd' | 'srs' | 'technical-documentation') => {
    if (!projectId) return;
    setGenerating(docType);
    try {
      await fastApiRequest(`/generate/${docType}`, {
        method: 'POST',
        body: { project_id: projectId },
      });
      reload();
    } catch (e) {
      alert(`Failed to generate ${docType.toUpperCase()}: ` + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setGenerating(null);
    }
  }, [projectId, reload]);

  // Count artifacts per section
  const sectionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const art of artifacts) {
      const sectionId = ARTIFACT_TYPE_TO_SECTION[art.artifact_type];
      if (sectionId) counts[sectionId] = (counts[sectionId] || 0) + 1;
    }
    return counts;
  }, [artifacts]);

  // Filter artifacts by section and search
  const selectedArtifacts = useMemo(() => {
    if (!selectedSection) return [];
    const section = docSections.find((s) => s.id === selectedSection);
    if (!section) return [];
    let filtered = artifacts.filter((a) => section.artifactTypes.includes(a.artifact_type));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((a) => {
        const label = ARTIFACT_TYPE_LABELS[a.artifact_type] || a.artifact_type;
        return label.toLowerCase().includes(q) || a.artifact_type.toLowerCase().includes(q);
      });
    }
    return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [artifacts, selectedSection, searchQuery]);

  const handleExportAll = useCallback(async () => {
    if (!projectId) return;
    setExporting(true);
    setExportStatus('loading');
    try {
      const url = buildApiUrl(`/documents/export-all?project_id=${projectId}`);
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `ey_sdlc_export_${projectId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      setExportStatus('success');
      setTimeout(() => setExportStatus('idle'), 3000);
    } catch {
      setExportStatus('error');
      setTimeout(() => setExportStatus('idle'), 3000);
    } finally {
      setExporting(false);
    }
  }, [projectId]);

  const handleUpdateArtifact = useCallback(async (id: number, content: Record<string, unknown>) => {
    await apiRequest(`/generated_artifacts/${id}`, {
      method: 'PUT',
      body: { content: JSON.stringify(content) },
    });
    reload();
  }, [reload]);

  const totalArtifacts = artifacts.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Documentation Center</h1>
          <p className="mt-1 text-sm text-text-muted">
            {totalArtifacts > 0 ? `${totalArtifacts} generated deliverables` : 'Auto-generated project documentation'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportAll}
            disabled={exporting || totalArtifacts === 0}
            className="btn-secondary text-sm"
          >
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Package className="mr-2 h-4 w-4" />
            )}
            {exportStatus === 'loading' ? 'Exporting...' : exportStatus === 'success' ? 'Exported!' : exportStatus === 'error' ? 'Failed' : 'Export All'}
          </button>
          <button className="btn-primary text-sm">
            <ExternalLink className="mr-2 h-4 w-4" />
            Open Wiki
          </button>
        </div>
      </div>

      {/* Search & View Toggle */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search documentation..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field w-full pl-9"
          />
        </div>
        <div className="flex items-center gap-1 bg-dark-bg border border-dark-border rounded-lg p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 rounded text-xs ${viewMode === 'grid' ? 'bg-ey-yellow/20 text-ey-yellow' : 'text-text-muted hover:text-text-primary'}`}
          >
            Grid
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded text-xs ${viewMode === 'list' ? 'bg-ey-yellow/20 text-ey-yellow' : 'text-text-muted hover:text-text-primary'}`}
          >
            List
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Document Sections */}
        <div className="lg:col-span-1">
          <Card>
            <h3 className="section-title">Document Sections</h3>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {docSections.map((section) => {
                const Icon = section.icon;
                const count = sectionCounts[section.id] || 0;
                return (
                  <button
                    key={section.id}
                    onClick={() => setSelectedSection(section.id)}
                    className={`w-full flex items-center gap-3 rounded-lg p-3 transition-all ${
                      selectedSection === section.id
                        ? 'bg-ey-yellow/10 border border-ey-yellow/30'
                        : 'bg-dark-bg hover:bg-dark-cardHover border border-transparent'
                    }`}
                  >
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${section.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-medium text-text-primary">{section.name}</p>
                      <p className="text-[10px] text-text-muted">{count} {count === 1 ? 'document' : 'documents'}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-text-muted" />
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Document List */}
        <div className="lg:col-span-3 space-y-6">
          {selectedSection && docSections.find((s) => s.id === selectedSection) && (
            <>
              {/* Section Header */}
              <Card>
                {(() => {
                  const section = docSections.find((s) => s.id === selectedSection)!;
                  const Icon = section.icon;
                  const count = sectionCounts[section.id] || 0;
                  return (
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${section.color}`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-text-primary">{section.name}</h3>
                          <p className="text-xs text-text-muted">{count} {count === 1 ? 'document' : 'documents'} generated</p>
                        </div>
                      </div>
                      {(section.id === 'brd' || section.id === 'srs' || section.id === 'techdoc') && (
                        <button
                          onClick={() => handleGenerateDoc(
                            section.id === 'techdoc' ? 'technical-documentation' : (section.id as 'brd' | 'srs')
                          )}
                          disabled={generating === (section.id === 'techdoc' ? 'technical-documentation' : section.id)}
                          className="btn-primary text-xs"
                        >
                          {generating === (section.id === 'techdoc' ? 'technical-documentation' : section.id) ? (
                            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-1.5 h-3 w-3" />
                          )}
                          {generating === (section.id === 'techdoc' ? 'technical-documentation' : section.id) ? `Generating ${section.name}...` : `Generate ${section.name}`}
                        </button>
                      )}
                    </div>
                  );
                })()}

                {/* Loading state */}
                {loading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-ey-yellow" />
                  </div>
                )}

                {/* Error state */}
                {error && (
                  <div className="flex items-center gap-2 rounded-lg bg-status-error/10 border border-status-error/30 px-4 py-3 text-xs text-status-error">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    {error}
                    <button onClick={reload} className="ml-auto underline hover:no-underline">Retry</button>
                  </div>
                )}

                {/* Document Grid/List */}
                {!loading && !error && (
                  viewMode === 'grid' ? (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {selectedArtifacts.length === 0 && (
                        <div className="col-span-full py-8 text-center">
                          <FileText className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                          <p className="text-sm text-text-muted">No documents generated yet for this section.</p>
                          <p className="text-xs text-text-muted mt-1">Run the corresponding agent in the pipeline to generate deliverables.</p>
                        </div>
                      )}
                      {selectedArtifacts.map((doc, index) => {
                        const contentStr = typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content);
                        const bytes = new TextEncoder().encode(contentStr).length;
                        const kb = (bytes / 1024).toFixed(1);
                        const icon = ARTIFACT_TYPE_ICONS[doc.artifact_type] || <Folder className="h-5 w-5 text-ey-yellow" />;
                        const label = ARTIFACT_TYPE_LABELS[doc.artifact_type] || doc.artifact_type;

                        return (
                          <motion.div
                            key={doc.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.05 }}
                            className="rounded-lg border border-dark-border bg-dark-bg p-4 hover:border-ey-yellow/30 transition-colors cursor-pointer"
                            onClick={() => setSelectedArtifact(doc)}
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ey-yellow/10">
                                {icon}
                              </div>
                              <StatusBadge status="success">{kb} KB</StatusBadge>
                            </div>
                            <p className="text-sm font-medium text-text-primary mb-2">{label}</p>
                            <div className="flex items-center gap-3 text-xs text-text-muted">
                              <span>{doc.artifact_type}</span>
                              <span>|</span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {new Date(doc.created_at).toLocaleString()}
                              </span>
                            </div>
                            <div className="flex gap-2 mt-3">
                              <button
                                className="btn-ghost text-xs flex-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedArtifact(doc);
                                }}
                              >
                                <Eye className="mr-1 h-3 w-3" />
                                View
                              </button>
                              <button
                                className="btn-ghost text-xs flex-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const content = typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content);
                                  const blob = new Blob([content], { type: 'application/json' });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `${doc.artifact_type}_${doc.id}.json`;
                                  document.body.appendChild(a);
                                  a.click();
                                  document.body.removeChild(a);
                                  URL.revokeObjectURL(url);
                                }}
                              >
                                <Download className="mr-1 h-3 w-3" />
                                Download
                              </button>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedArtifacts.length === 0 && (
                        <div className="py-8 text-center">
                          <FileText className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
                          <p className="text-sm text-text-muted">No documents generated yet for this section.</p>
                        </div>
                      )}
                      {selectedArtifacts.map((doc, index) => {
                        const icon = ARTIFACT_TYPE_ICONS[doc.artifact_type] || <Folder className="h-4 w-4 text-ey-yellow" />;
                        const label = ARTIFACT_TYPE_LABELS[doc.artifact_type] || doc.artifact_type;
                        const contentStr = typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content);
                        const bytes = new TextEncoder().encode(contentStr).length;
                        const kb = (bytes / 1024).toFixed(1);

                        return (
                          <motion.div
                            key={doc.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.03 }}
                            className="flex items-center gap-4 p-3 rounded-lg border border-dark-border bg-dark-bg hover:border-ey-yellow/30 transition-colors cursor-pointer"
                            onClick={() => setSelectedArtifact(doc)}
                          >
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ey-yellow/10 flex-shrink-0">
                              {icon}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-text-primary truncate">{label}</p>
                              <p className="text-xs text-text-muted">{new Date(doc.created_at).toLocaleString()}</p>
                            </div>
                            <StatusBadge status="info">{kb} KB</StatusBadge>
                            <div className="flex items-center gap-2">
                              <button
                                className="btn-ghost text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedArtifact(doc);
                                }}
                              >
                                <Eye className="h-3 w-3" />
                              </button>
                              <button
                                className="btn-ghost text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const content = typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content);
                                  const blob = new Blob([content], { type: 'application/json' });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `${doc.artifact_type}_${doc.id}.json`;
                                  document.body.appendChild(a);
                                  a.click();
                                  document.body.removeChild(a);
                                  URL.revokeObjectURL(url);
                                }}
                              >
                                <Download className="h-3 w-3" />
                              </button>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Generation Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="text-center">
          <FileText className="h-5 w-5 text-ey-yellow mx-auto mb-2" />
          <p className="text-2xl font-bold text-text-primary">{totalArtifacts}</p>
          <p className="text-xs text-text-muted">Total Documents</p>
        </Card>
        <Card className="text-center">
          <Clock className="h-5 w-5 text-status-info mx-auto mb-2" />
          <p className="text-2xl font-bold text-text-primary">{docSections.filter((s) => sectionCounts[s.id]).length}</p>
          <p className="text-xs text-text-muted">Sections Populated</p>
        </Card>
        <Card className="text-center">
          <CheckCircle2 className="h-5 w-5 text-status-success mx-auto mb-2" />
          <p className="text-2xl font-bold text-status-success">100%</p>
          <p className="text-xs text-text-muted">Auto-Generated</p>
        </Card>
        <Card className="text-center">
          <Download className="h-5 w-5 text-text-secondary mx-auto mb-2" />
          <p className="text-2xl font-bold text-text-primary">{exportStatus === 'success' ? '1' : '0'}</p>
          <p className="text-xs text-text-muted">Recent Exports</p>
        </Card>
      </div>

      {/* Document Viewer Modal */}
      <AnimatePresence>
        {selectedArtifact && (
          <DocumentViewer
            artifact={selectedArtifact}
            onClose={() => setSelectedArtifact(null)}
            onUpdate={handleUpdateArtifact}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
// ─── Technical Documentation viewer (collapsible full-platform doc) ───────────

function DocSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-dark-border overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 bg-dark-surface/50 hover:bg-dark-surface transition-colors">
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        {open ? <ChevronDown className="h-4 w-4 text-text-muted" /> : <ChevronRight className="h-4 w-4 text-text-muted" />}
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

function Bullets({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-xs text-text-secondary leading-relaxed"><span className="text-ey-yellow mt-0.5">•</span><span>{it}</span></li>
      ))}
    </ul>
  );
}

function TechnicalDocView({ doc }: { doc: any }) {
  if (!doc || typeof doc !== 'object') return <pre className="text-xs text-text-muted">{JSON.stringify(doc, null, 2)}</pre>;
  const ov = doc.overview || {};
  const api = doc.api_documentation || {};
  const db = doc.database_schema || {};
  const sec = doc.security || {};
  const ms = doc.microservices || {};
  const eh = doc.error_handling || {};
  const dep = doc.deployment_architecture || {};
  const test = doc.testing_strategy || {};

  return (
    <div className="space-y-3">
      {/* Overview always open */}
      <div className="rounded-lg border border-ey-yellow/30 bg-ey-yellow/5 p-4">
        <h2 className="text-base font-bold text-text-primary mb-1">{ov.title || 'Technical Documentation'}</h2>
        <p className="text-xs text-text-secondary leading-relaxed">{ov.summary}</p>
        <p className="text-[11px] text-text-muted mt-2">{ov.scope}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          {Object.entries(ov.primary_stack || {}).map(([k, v]) => (
            <span key={k} className="text-[10px] px-2 py-0.5 rounded-full bg-dark-surface text-text-secondary"><span className="text-ey-yellow">{k}:</span> {String(v)}</span>
          ))}
        </div>
      </div>

      <DocSection title={`Module Breakdown (${(doc.module_breakdown || []).length})`} defaultOpen>
        <div className="grid gap-2 md:grid-cols-2">
          {(doc.module_breakdown || []).map((m: any, i: number) => (
            <div key={i} className="rounded-lg bg-dark-surface/50 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-text-primary">{m.name}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-dark-border text-text-muted">{m.layer}</span>
              </div>
              {m.technology && <p className="text-[10px] text-ey-yellow mb-1">{m.technology}</p>}
              <p className="text-[11px] text-text-muted">{m.responsibility}</p>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection title={`Feature Specifications (${(doc.feature_specifications || []).length})`}>
        <div className="space-y-2">
          {(doc.feature_specifications || []).map((f: any, i: number) => (
            <div key={i} className="rounded-lg bg-dark-surface/50 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono text-ey-yellow">{f.id}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-dark-border text-text-muted">{f.category}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-dark-border text-text-muted">{f.priority}</span>
              </div>
              <p className="text-xs text-text-primary">{f.description}</p>
              {f.business_rules && <div className="mt-2"><p className="text-[10px] uppercase text-text-muted mb-1">Business Rules</p><Bullets items={f.business_rules} /></div>}
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection title={`API Documentation (${(api.endpoints || []).length} endpoints)`}>
        <p className="text-[11px] text-text-muted mb-2">{api.authentication}</p>
        <Bullets items={api.conventions} />
        <div className="mt-3 space-y-1">
          {(api.endpoints || []).map((ep: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[11px] font-mono rounded bg-dark-surface/50 px-2 py-1">
              <span className={`font-semibold w-14 ${ep.method === 'GET' ? 'text-status-info' : ep.method === 'DELETE' ? 'text-status-error' : 'text-status-success'}`}>{ep.method}</span>
              <span className="text-text-secondary flex-1">{ep.path}</span>
              <span className="text-text-muted text-[10px]">{ep.success}</span>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection title={`Database Schema (${(db.tables || []).length} tables)`}>
        <p className="text-[11px] text-text-muted mb-2">{db.engine}</p>
        <div className="grid gap-2 md:grid-cols-2">
          {(db.tables || []).map((t: any, i: number) => (
            <div key={i} className="rounded-lg bg-dark-surface/50 p-3">
              <p className="text-xs font-semibold text-ey-yellow mb-1 font-mono">{t.name}</p>
              <div className="space-y-0.5">
                {(t.columns || []).map((c: any, j: number) => (
                  <div key={j} className="text-[10px] font-mono text-text-muted flex gap-2">
                    <span className="text-text-secondary">{c.name}</span><span>{c.type}</span>
                    {c.primary_key && <span className="text-ey-yellow">PK</span>}
                    {c.unique && <span className="text-status-info">UQ</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection title={`User Flows (${(doc.user_flows || []).length})`}>
        <div className="space-y-3">
          {(doc.user_flows || []).map((fl: any, i: number) => (
            <div key={i} className="rounded-lg bg-dark-surface/50 p-3">
              <p className="text-xs font-semibold text-text-primary mb-2">{fl.name} <span className="text-[10px] text-text-muted">({fl.actor})</span></p>
              <ol className="space-y-1 list-decimal list-inside">
                {(fl.steps || []).map((s: string, j: number) => <li key={j} className="text-[11px] text-text-secondary">{s}</li>)}
              </ol>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection title="Security">
        <div className="grid gap-3 md:grid-cols-2">
          <div><p className="text-[10px] uppercase text-text-muted mb-1">Data Protection</p><Bullets items={sec.data_protection} /></div>
          <div><p className="text-[10px] uppercase text-text-muted mb-1">Application Security</p><Bullets items={sec.application_security} /></div>
        </div>
        <p className="text-[11px] text-text-muted mt-2"><span className="text-ey-yellow">Auth:</span> {sec.authentication} · {sec.authorization}</p>
      </DocSection>

      <DocSection title={`Integrations (${(doc.integrations || []).length})`}>
        <div className="grid gap-2 md:grid-cols-2">
          {(doc.integrations || []).map((it: any, i: number) => (
            <div key={i} className="rounded-lg bg-dark-surface/50 p-3">
              <p className="text-xs font-semibold text-text-primary">{it.name} <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-dark-border text-text-muted">{it.type}</span></p>
              <p className="text-[10px] text-ey-yellow">{it.technology}</p>
              <p className="text-[11px] text-text-muted mt-1">{it.pattern}</p>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection title="Microservices">
        {ms.applicable ? (
          <div>
            <p className="text-[11px] text-text-muted mb-2">{ms.communication}</p>
            <div className="grid gap-2 md:grid-cols-2">
              {(ms.services || []).map((s: any, i: number) => (
                <div key={i} className="rounded-lg bg-dark-surface/50 p-3">
                  <p className="text-xs font-semibold text-text-primary">{s.name} {s.port && <span className="text-[10px] text-text-muted font-mono">:{s.port}</span>}</p>
                  <p className="text-[10px] text-ey-yellow">{s.technology}</p>
                  <p className="text-[11px] text-text-muted mt-1">{s.responsibility}</p>
                </div>
              ))}
            </div>
          </div>
        ) : <p className="text-[11px] text-text-muted">{ms.note}</p>}
      </DocSection>

      <DocSection title="Error Handling">
        <p className="text-[11px] text-text-muted mb-2">{eh.strategy}</p>
        <div className="space-y-1">
          {(eh.http_mapping || []).map((m: any, i: number) => (
            <div key={i} className="text-[11px] flex gap-2"><span className="font-mono text-ey-yellow w-40 flex-shrink-0">{m.status}</span><span className="text-text-muted">{m.when}</span></div>
          ))}
        </div>
        <div className="mt-2"><Bullets items={eh.practices} /></div>
      </DocSection>

      <DocSection title="Deployment Architecture">
        <p className="text-[11px] text-text-muted mb-2">{dep.topology}</p>
        <p className="text-[10px] text-text-muted mb-2">Environments: {(dep.environments || []).join(' → ')}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div><p className="text-[10px] uppercase text-text-muted mb-1">CI/CD</p><Bullets items={dep.cicd} /></div>
          <div><p className="text-[10px] uppercase text-text-muted mb-1">Infrastructure</p><Bullets items={dep.infrastructure} /></div>
        </div>
      </DocSection>

      <DocSection title="Testing Strategy">
        <div className="space-y-2">
          {(test.pyramid || []).map((p: any, i: number) => (
            <div key={i} className="rounded-lg bg-dark-surface/50 p-3">
              <p className="text-xs font-semibold text-text-primary">{p.level} <span className="text-[10px] text-ey-yellow">{p.coverage_target}</span></p>
              <p className="text-[11px] text-text-muted">{p.scope}</p>
            </div>
          ))}
        </div>
        <div className="mt-2"><Bullets items={test.additional} /></div>
      </DocSection>

      <DocSection title={`Non-Functional Requirements (${(doc.non_functional_requirements || []).length})`}>
        <div className="grid gap-2 md:grid-cols-2">
          {(doc.non_functional_requirements || []).map((n: any, i: number) => (
            <div key={i} className="rounded-lg bg-dark-surface/50 p-3">
              <p className="text-xs font-semibold text-ey-yellow">{n.attribute}</p>
              <p className="text-[11px] text-text-muted">{n.target}</p>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection title="Development Roadmap">
        <div className="space-y-2">
          {(doc.development_roadmap || []).map((ph: any, i: number) => (
            <div key={i} className="rounded-lg bg-dark-surface/50 p-3">
              <p className="text-xs font-semibold text-text-primary">{ph.phase} <span className="text-[10px] text-text-muted">{ph.duration}</span></p>
              <Bullets items={ph.items} />
            </div>
          ))}
        </div>
      </DocSection>
    </div>
  );
}
