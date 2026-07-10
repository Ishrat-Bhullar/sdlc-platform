import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Monitor,
  Smartphone,
  Tablet,
  MousePointer,
  Users,
  Zap,
  Download,
  FileJson,
  FileType,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Palette,
  Loader2,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar } from '../components/ui/Card';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import { apiRequest, buildApiUrl } from '../lib/api';
import type { UIUXDesignContent } from '../types/unified';

interface StyleColorToken {
  name: string;
  hex: string;
  usage: string;
}

interface StyleOption {
  name: string;
  description: string;
  colorPalette?: { primary?: StyleColorToken[]; neutral?: StyleColorToken[]; semantic?: StyleColorToken[] };
  typography?: { fontFamily?: string };
  buttonStyle?: string;
  layoutDescription?: string;
}

// Matches GET /projects/{id}/approvals (backend/fastapi_agents/main_extension.py) —
// artifact_type is a plain string ("ui_style_selection" for this gate); status is
// one of ApprovalStatus's values ("Pending Approval", "Approved", ...).
interface PendingApproval {
  id: number;
  project_id: number;
  artifact_type: string;
  status: string;
}

interface GeneratedArtifactRow {
  id: number;
  project_id: number;
  artifact_type: string;
  content: string;
  created_at: string;
}

function StyleSelectionGate({ projectId }: { projectId: string }) {
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [styleOptions, setStyleOptions] = useState<StyleOption[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selectError, setSelectError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const approvals = await apiRequest<PendingApproval[]>(
          `/projects/${projectId}/approvals?status_filter=${encodeURIComponent('Pending Approval')}`
        );
        const styleApproval = approvals.find((a) => a.artifact_type === 'ui_style_selection') || null;
        if (cancelled) return;
        setPending(styleApproval);
        if (!styleApproval) {
          setStyleOptions([]);
          return;
        }
        // styleOptions live on the UI/UX Agent's own artifact, not the
        // approval row itself — the approval is just the gate.
        const artifacts = await apiRequest<GeneratedArtifactRow[]>(
          `/generated_artifacts?project_id=${projectId}&artifact_type=uiux_design`
        );
        const latest = artifacts[artifacts.length - 1];
        if (cancelled) return;
        try {
          const parsed = JSON.parse(latest?.content || '{}');
          setStyleOptions(parsed.styleOptions || []);
        } catch {
          setStyleOptions([]);
        }
      } catch {
        if (!cancelled) { setPending(null); setStyleOptions([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  if (!pending || styleOptions.length === 0) return null;

  const handleSelect = async (style: StyleOption) => {
    setSelecting(true);
    setSelectError(null);
    try {
      await apiRequest(`/projects/${projectId}/approvals/${pending.id}/decide`, {
        method: 'POST',
        body: { decision: 'Approved', selection: style },
      });
      setPending(null);
    } catch (e) {
      setSelectError(e instanceof Error ? e.message : 'Failed to select style');
      setSelecting(false);
    }
  };

  return (
    <Card className="border-ey-yellow/40 bg-ey-yellow/5">
      <div className="flex items-center gap-2 mb-1">
        <Palette className="h-5 w-5 text-ey-yellow" />
        <h3 className="text-lg font-semibold text-text-primary">Choose a UI Style Direction</h3>
      </div>
      <p className="text-xs text-text-muted mb-4">
        The pipeline is paused until you pick one — Frontend generation will follow this style's palette, typography, and layout.
      </p>
      {selectError && <div className="mb-3 text-xs text-status-error">{selectError}</div>}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {styleOptions.map((style, idx) => {
          const swatches = [
            ...(style.colorPalette?.primary || []),
            ...(style.colorPalette?.neutral || []),
            ...(style.colorPalette?.semantic || []),
          ].slice(0, 6);
          return (
            <div key={idx} className="rounded-lg bg-dark-bg border border-dark-border p-4 flex flex-col">
              <h4 className="text-sm font-semibold text-text-primary">{style.name}</h4>
              <p className="text-xs text-text-muted mt-1 flex-1">{style.description}</p>
              {swatches.length > 0 && (
                <div className="flex items-center gap-1.5 mt-3">
                  {swatches.map((token, ti) => (
                    <span
                      key={ti}
                      className="h-5 w-5 rounded-full border border-dark-border"
                      style={{ backgroundColor: token.hex }}
                      title={`${token.name}: ${token.hex}`}
                    />
                  ))}
                </div>
              )}
              {style.typography?.fontFamily && (
                <p className="text-[11px] text-text-secondary mt-2" style={{ fontFamily: style.typography.fontFamily }}>
                  {style.typography.fontFamily.split(',')[0]} — Sample heading
                </p>
              )}
              {style.buttonStyle && <p className="text-[10px] text-text-muted mt-2">Buttons: {style.buttonStyle}</p>}
              {style.layoutDescription && <p className="text-[10px] text-text-muted mt-1">Layout: {style.layoutDescription}</p>}
              <button
                onClick={() => handleSelect(style)}
                disabled={selecting}
                className="btn-primary text-xs mt-3 flex items-center justify-center disabled:opacity-40"
              >
                {selecting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Use this style
              </button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function UIUXWorkspace() {
  const [activeTab, setActiveTab] = useState<'screens' | 'flows' | 'wireframes' | 'components' | 'recommendations' | 'styles'>('screens');
  const projectId = getSelectedProjectId();
  const { getUIUXDesign, getArtifact, loading, error, reload, downloadArtifact } = useUnifiedArtifacts(projectId);

  const design = getUIUXDesign();
  const selectedStyleName = (getArtifact('selected_ui_style') as { name?: string } | null)?.name || null;

  const handleExport = async (format: 'json' | 'md') => {
    if (!projectId || !design) return;
    try {
      const content = JSON.stringify(design, null, 2);
      const blob = new Blob([content], { type: 'application/json' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `uiux_design_${projectId}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  if (!projectId) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <AlertTriangle className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">No project selected</p>
          <p className="text-xs text-text-muted mt-1">Select a project in the Dashboard to view UI/UX design.</p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <RefreshCw className="h-10 w-10 text-ey-yellow animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-muted">Loading UI/UX design...</p>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Card className="border-status-error/30 bg-status-error/5 text-sm text-status-error">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
            <button onClick={reload} className="ml-auto underline hover:no-underline">Retry</button>
          </div>
        </Card>
      </div>
    );
  }

  if (!design) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <Monitor className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm text-text-muted">No UI/UX design generated yet.</p>
          <p className="text-xs text-text-muted mt-1">Run the UI/UX Design Agent to generate screens, user flows, and wireframes.</p>
        </Card>
      </div>
    );
  }

  const metrics = [
    { label: 'Screens', value: design.screens?.length || 0, icon: Monitor, color: 'text-status-info' },
    { label: 'User Flows', value: design.userFlows?.length || 0, icon: Users, color: 'text-status-success' },
    { label: 'Wireframes', value: design.wireframes?.length || 0, icon: Tablet, color: 'text-status-warning' },
    { label: 'Recommendations', value: (design.componentRecommendations?.length || 0) + (design.uxRecommendations?.length || 0), icon: Zap, color: 'text-ey-yellow' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">UI/UX Design Workspace</h1>
          <p className="mt-1 text-sm text-text-muted">User interface and experience design artifacts</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status="success">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Design Generated
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
          </div>
        </div>
      </div>

      {/* Style selection gate — only renders when a style-selection approval is pending */}
      <StyleSelectionGate projectId={projectId} />

      {/* Metrics row */}
      <div className="grid gap-3 md:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label} className="text-center py-3">
            <metric.icon className={`h-5 w-5 ${metric.color} mx-auto mb-1`} />
            <p className="text-xl font-bold text-text-primary">{metric.value}</p>
            <p className="text-[10px] text-text-muted">{metric.label}</p>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-dark-border">
        {[
          { id: 'screens', label: 'Screens', icon: Monitor },
          { id: 'flows', label: 'User Flows', icon: Users },
          { id: 'wireframes', label: 'Wireframes', icon: Tablet },
          { id: 'components', label: 'Components', icon: MousePointer },
          { id: 'recommendations', label: 'Recommendations', icon: Zap },
          ...(design.styleOptions?.length ? [{ id: 'styles', label: 'Style Options', icon: Palette }] : []),
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

      {/* Screens tab */}
      {activeTab === 'screens' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Monitor className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Application Screens</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {design.screens?.map((screen, idx) => (
              <div key={idx} className="rounded-lg bg-dark-bg p-4 border border-dark-border">
                <div className="flex items-center gap-2 mb-2">
                  <Smartphone className="h-4 w-4 text-ey-yellow" />
                  <h4 className="text-sm font-medium text-text-primary">{screen.name}</h4>
                </div>
                <p className="text-xs text-text-muted">{screen.purpose}</p>
                {screen.components?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {screen.components.map((c, ci) => (
                      <span key={ci} className="text-[10px] px-2 py-0.5 rounded-full bg-ey-yellow/10 text-ey-yellow">{c}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* User Flows tab */}
      {activeTab === 'flows' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">User Flows</h3>
          </div>
          <div className="space-y-3">
            {design.userFlows?.map((flow, idx) => (
              <div key={idx} className="rounded-lg bg-dark-bg p-4 border border-dark-border">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="h-6 w-6 rounded-full bg-ey-yellow/20 flex items-center justify-center text-xs font-bold text-ey-yellow">
                      {idx + 1}
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-text-primary">{flow.name}</p>
                    {flow.steps?.length > 0 && (
                      <ol className="mt-1 list-decimal list-inside text-xs text-text-muted space-y-0.5">
                        {flow.steps.map((step, si) => (
                          <li key={si}>{step}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Wireframes tab */}
      {activeTab === 'wireframes' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Tablet className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Wireframes</h3>
          </div>
          <div className="space-y-3">
            {design.wireframes?.map((wireframe, idx) => (
              <div key={idx} className="rounded-lg bg-dark-bg p-4 border border-dark-border">
                <p className="text-sm text-text-primary font-medium">{wireframe.screen}</p>
                <p className="text-xs text-text-muted mt-1">{wireframe.layout}</p>
                <p className="text-xs text-text-muted mt-1">{wireframe.description}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Components tab */}
      {activeTab === 'components' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <MousePointer className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Component Recommendations</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {design.componentRecommendations?.map((rec, idx) => (
              <div key={idx} className="rounded-lg bg-dark-bg p-3 border border-dark-border">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-status-success mt-0.5" />
                  <div>
                    <p className="text-xs text-text-primary font-medium">{rec.name} <span className="text-text-muted font-normal">({rec.type}{rec.library ? ` · ${rec.library}` : ''})</span></p>
                    <p className="text-xs text-text-muted mt-1">{rec.rationale}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recommendations tab */}
      {activeTab === 'recommendations' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">UX Recommendations</h3>
          </div>
          <div className="space-y-3">
            {design.uxRecommendations?.map((rec, idx) => (
              <div key={idx} className="rounded-lg bg-dark-bg p-4 border border-dark-border">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <Zap className="h-4 w-4 text-ey-yellow" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-text-primary">{rec}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Style Options tab — the same directions the style-selection gate
          offered before Frontend generation, kept visible permanently (the
          gate itself only renders while its approval is still pending). */}
      {activeTab === 'styles' && (
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <Palette className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Style Directions</h3>
          </div>
          <p className="text-xs text-text-muted mb-4">
            {selectedStyleName
              ? `"${selectedStyleName}" was selected — Frontend generation followed its palette, typography, and layout.`
              : 'Generated by the UI/UX Agent before Frontend generation began.'}
          </p>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {design.styleOptions?.map((style, idx) => {
              const swatches = [
                ...(style.colorPalette?.primary || []),
                ...(style.colorPalette?.neutral || []),
                ...(style.colorPalette?.semantic || []),
              ].slice(0, 6);
              const isSelected = selectedStyleName === style.name;
              return (
                <div
                  key={idx}
                  className={`rounded-lg bg-dark-bg p-4 flex flex-col border ${
                    isSelected ? 'border-ey-yellow' : 'border-dark-border'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-text-primary">{style.name}</h4>
                    {isSelected && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-ey-yellow/10 text-ey-yellow">Selected</span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-1 flex-1">{style.description}</p>
                  {swatches.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-3">
                      {swatches.map((token, ti) => (
                        <span
                          key={ti}
                          className="h-5 w-5 rounded-full border border-dark-border"
                          style={{ backgroundColor: token.hex }}
                          title={`${token.name}: ${token.hex}`}
                        />
                      ))}
                    </div>
                  )}
                  {style.typography?.fontFamily && (
                    <p className="text-[11px] text-text-secondary mt-2" style={{ fontFamily: style.typography.fontFamily }}>
                      {style.typography.fontFamily.split(',')[0]} — Sample heading
                    </p>
                  )}
                  {style.buttonStyle && <p className="text-[10px] text-text-muted mt-2">Buttons: {style.buttonStyle}</p>}
                  {style.layoutDescription && <p className="text-[10px] text-text-muted mt-1">Layout: {style.layoutDescription}</p>}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}