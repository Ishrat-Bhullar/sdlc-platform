import { useEffect, useMemo, useState } from 'react';
import {
  Monitor,
  Smartphone,
  Tablet,
  MousePointer,
  Users,
  Zap,
  FileJson,
  FileType,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Palette,
  Loader2,
  Sparkles,
  LayoutGrid,
} from 'lucide-react';
import { Card, StatusBadge } from '../components/ui/Card';
import { ApprovalBadge, ApprovalBanner } from '../components/ui/ApprovalStatus';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { useAgentStatus } from '../lib/AgentStatusService';
import { checkpointGateStatus } from '../lib/checkpointStatus';
import { getSelectedProjectId } from '../lib/projectContext';
import { apiRequest, buildApiUrl } from '../lib/api';
import type { UIUXDesignContent, UIUXScreen, UIUXStyleOption } from '../types/unified';
import { AIDesignWizard, type WizardConfig } from '../components/uiux/AIDesignWizard';
import { AIDesignChat, type ChatMessage } from '../components/uiux/AIDesignChat';
import { DesignCanvas } from '../components/uiux/DesignCanvas';
import { DesignSystemManager } from '../components/uiux/DesignSystemManager';
import { UserFlows } from '../components/uiux/UserFlows';
import { IntegrationFeed } from '../components/uiux/IntegrationFeed';
import { markStudioDraftDirty, clearStudioDraft } from '../components/shared/AutoSaveIndicator';
import { artifactToMarkdown } from '../lib/toMarkdown';

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
  const [styleOptions, setStyleOptions] = useState<UIUXStyleOption[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selectError, setSelectError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

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

  const handleSelect = async (style: UIUXStyleOption) => {
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
        The pipeline is paused until you pick one — Frontend generation will build exactly this design's screens, navigation, and components, not just follow its palette and typography.
      </p>
      {selectError && <div className="mb-3 text-xs text-status-error">{selectError}</div>}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {styleOptions.map((style, idx) => {
          const swatches = [
            ...(style.colorPalette?.primary || []),
            ...(style.colorPalette?.neutral || []),
            ...(style.colorPalette?.semantic || []),
          ].slice(0, 6);
          const screens = style.screens || [];
          const isExpanded = expandedIdx === idx;
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
              {style.navigation && <p className="text-[10px] text-text-muted mt-1">Navigation: {style.navigation}</p>}
              {screens.length > 0 && (
                <button
                  onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                  className="text-[10px] text-ey-yellow mt-2 text-left underline hover:no-underline"
                >
                  {isExpanded ? 'Hide' : 'Preview'} {screens.length} screen{screens.length === 1 ? '' : 's'} in this design
                </button>
              )}
              {isExpanded && (
                <div className="mt-2 space-y-1.5 rounded border border-dark-border bg-black/20 p-2">
                  {screens.map((screen, si) => (
                    <div key={si} className="text-[10px]">
                      <span className="font-medium text-text-primary">{screen.name}</span>
                      {screen.components?.length > 0 && (
                        <span className="text-text-muted"> — {screen.components.join(', ')}</span>
                      )}
                    </div>
                  ))}
                  {(style.dataVisualizations?.length ?? 0) > 0 && (
                    <div className="text-[10px] text-text-muted pt-1 border-t border-dark-border/60">
                      Charts/tables: {style.dataVisualizations!.join('; ')}
                    </div>
                  )}
                  {style.responsiveness && (
                    <div className="text-[10px] text-text-muted">Responsive: {style.responsiveness}</div>
                  )}
                </div>
              )}
              <button
                onClick={() => handleSelect(style)}
                disabled={selecting}
                className="btn-primary text-xs mt-3 flex items-center justify-center disabled:opacity-40"
              >
                {selecting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Use this design
              </button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// The interactive UI/UX Design Studio — ported from Bhumika's AI Design
// Studio (wizard/canvas/chat/design-system-manager/user-flows/integration-feed),
// rewired end-to-end to this app's real backend: generation and refinement
// both go through POST /agents/uiux (persisted via the project_id param
// added to that route), and "handoff" to Frontend generation is the
// existing StyleSelectionGate approval flow above — not a separate
// localStorage-simulated mechanism.
function DesignStudio({
  projectId, design, selectedDesign, reload,
}: {
  projectId: string;
  design: UIUXDesignContent;
  // The actually-selected design (from the "selected_ui_style" artifact) if
  // the user has already picked one via StyleSelectionGate — this, not the
  // generic design.styleOptions[0], is what Frontend Agent will build from,
  // so the Canvas edits below and their persistence target this object.
  selectedDesign: UIUXStyleOption | null;
  reload: () => Promise<void>;
}) {
  const { getRequirements, getUserStories, artifacts } = useUnifiedArtifacts(projectId);
  const { stages } = useAgentStatus();
  const [projectDescription, setProjectDescription] = useState<string>('');
  const initialScreens = (selectedDesign?.screens?.length ? selectedDesign.screens : design.screens) || [];
  const [localScreens, setLocalScreens] = useState<UIUXScreen[]>(initialScreens);
  const [activeScreenIdx, setActiveScreenIdx] = useState<number>(0);
  const [selectedCompIdx, setSelectedCompIdx] = useState<number | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [refining, setRefining] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocalScreens((selectedDesign?.screens?.length ? selectedDesign.screens : design.screens) || []);
    setActiveScreenIdx(0);
    setDirty(false);
    clearStudioDraft(projectId);
  }, [design, selectedDesign, projectId]);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ name: string; description?: string }>(`/projects/${projectId}`)
      .then((p) => { if (!cancelled) setProjectDescription(p.description || p.name || ''); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  const selectedStyle = useMemo(
    () => selectedDesign || design.styleOptions?.[0] || null,
    [selectedDesign, design.styleOptions]
  );
  const activeScreen = localScreens[activeScreenIdx];

  const handleSaveDesign = async () => {
    if (!selectedDesign) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/projects/${projectId}/uiux/selected-design`, {
        method: 'PUT',
        body: { design: { ...selectedDesign, screens: localScreens } },
      });
      clearStudioDraft(projectId);
      setDirty(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save design changes');
    } finally {
      setSaving(false);
    }
  };

  const runGeneration = async (description: string) => {
    setGenerating(true);
    setError(null);
    try {
      await apiRequest('/agents/uiux', {
        method: 'POST',
        body: {
          project_description: description,
          requirements: getRequirements(),
          user_stories: getUserStories(),
          project_id: Number(projectId),
        },
      });
      await reload();
      setShowWizard(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleWizardComplete = (config: WizardConfig) => {
    const description = `${config.prompt}\n\nPlatform: ${config.platform}. Preferred style: ${config.color}. Layout: ${config.style}. Audience: ${config.users}. Pages to include: ${config.pages.join(', ')}.`;
    runGeneration(description);
  };

  const handleRefine = async (text: string) => {
    const now = new Date().toLocaleTimeString();
    setChatHistory((prev) => [...prev, { sender: 'user', text, time: now }]);
    setRefining(true);
    setError(null);
    try {
      const result = await apiRequest<UIUXDesignContent>('/agents/uiux', {
        method: 'POST',
        body: {
          project_description: projectDescription || 'Refine the existing UI/UX design',
          project_id: Number(projectId),
          refinement_instruction: text,
          existing_design: design,
        },
      });
      await reload();
      setChatHistory((prev) => [
        ...prev,
        { sender: 'agent', text: `Updated the design — ${result.screens?.length || 0} screens, ${result.styleOptions?.length || 0} style options.`, time: new Date().toLocaleTimeString() },
      ]);
    } catch (e) {
      setChatHistory((prev) => [...prev, { sender: 'agent', text: 'Refinement failed — please try again.', time: new Date().toLocaleTimeString() }]);
      setError(e instanceof Error ? e.message : 'Refinement failed');
    } finally {
      setRefining(false);
    }
  };

  const mutateActiveScreenComponents = (updater: (components: string[]) => string[]) => {
    setLocalScreens((prev) => prev.map((s, i) => (i === activeScreenIdx ? { ...s, components: updater(s.components || []) } : s)));
    markStudioDraftDirty(projectId);
    setDirty(true);
  };

  const pipelineStages = stages.map((s) => ({ key: AGENT_STAGE_KEY_MAP[s.key] || s.key, label: s.label, status: s.status }));

  if (!design.screens?.length && !showWizard) {
    return (
      <Card className="py-10 text-center space-y-4">
        <Sparkles className="h-10 w-10 text-ey-yellow mx-auto" />
        <p className="text-sm font-medium text-text-primary">No design generated yet</p>
        <p className="text-xs text-text-muted">Launch the AI Design Studio wizard to generate screens, a design system, and style options.</p>
        <button onClick={() => setShowWizard(true)} className="btn-primary text-sm mx-auto">Launch Design Wizard</button>
      </Card>
    );
  }

  if (showWizard) {
    return <AIDesignWizard onComplete={handleWizardComplete} onClose={() => setShowWizard(false)} submitting={generating} />;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-status-error">{error}</div>}
      {selectedDesign ? (
        <p className="text-[11px] text-text-muted">
          Editing the selected design ("{selectedDesign.name}") — Frontend Agent builds from exactly this. Save your Canvas edits before it runs.
        </p>
      ) : (
        <p className="text-[11px] text-text-muted">
          No design selected yet — Canvas edits here are draft-only until a style is chosen in the Approval Center gate; use Generate/Refine to persist changes in the meantime.
        </p>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {localScreens.map((s, i) => (
            <button
              key={i}
              onClick={() => { setActiveScreenIdx(i); setSelectedCompIdx(null); }}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                i === activeScreenIdx ? 'bg-ey-yellow/10 border-ey-yellow text-ey-yellow' : 'border-dark-border text-text-muted hover:text-text-primary'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {selectedDesign && (
            <button
              onClick={handleSaveDesign}
              disabled={saving || !dirty}
              className="btn-primary text-xs disabled:opacity-40"
              title={dirty ? 'Persist these Canvas edits into the selected design Frontend Agent will build from' : 'No unsaved edits'}
            >
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {saving ? 'Saving…' : dirty ? 'Save Design Changes' : 'Saved'}
            </button>
          )}
          <button onClick={() => setShowWizard(true)} className="btn-ghost text-xs">
            <LayoutGrid className="mr-1.5 h-3.5 w-3.5" /> Regenerate
          </button>
        </div>
      </div>

      {activeScreen && (
        <DesignCanvas
          activeScreen={activeScreen}
          style={selectedStyle}
          selectedCompIdx={selectedCompIdx}
          onSelectComponent={setSelectedCompIdx}
          onRemoveComponent={(name) => mutateActiveScreenComponents((c) => c.filter((x) => x !== name))}
          onMoveComponent={(idx, dir) =>
            mutateActiveScreenComponents((c) => {
              const next = [...c];
              const swap = dir === 'up' ? idx - 1 : idx + 1;
              if (swap < 0 || swap >= next.length) return next;
              [next[idx], next[swap]] = [next[swap], next[idx]];
              return next;
            })
          }
          onInsertComponent={(name) => mutateActiveScreenComponents((c) => [...c, name])}
          onRenameComponent={(idx, name) => mutateActiveScreenComponents((c) => c.map((x, i) => (i === idx ? name : x)))}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <AIDesignChat chatHistory={chatHistory} refining={refining} onSendMessage={handleRefine} />
        {design.designSystem && <DesignSystemManager designSystem={design.designSystem} />}
      </div>

      <UserFlows screens={localScreens} userFlows={design.userFlows || []} selectedIdx={activeScreenIdx} onSelectScreen={setActiveScreenIdx} />

      <IntegrationFeed artifacts={artifacts} pipelineStages={pipelineStages} />
    </div>
  );
}

// Maps pipeline-status stage keys (AgentName enum values, e.g. "UI/UX Design
// Agent") to the short keys IntegrationFeed's OUTPUT_STAGE_KEYS expects.
const AGENT_STAGE_KEY_MAP: Record<string, string> = {
  'Security Architect Agent': 'security',
  'Compliance Architect Agent': 'compliance',
  'Frontend Agent': 'frontend',
};

export function UIUXWorkspace() {
  const [activeTab, setActiveTab] = useState<'screens' | 'flows' | 'wireframes' | 'components' | 'recommendations' | 'styles' | 'studio'>('screens');
  const projectId = getSelectedProjectId();
  const { getUIUXDesign, getArtifact, loading, error, reload, downloadArtifact } = useUnifiedArtifacts(projectId);
  const { stages } = useAgentStatus();

  const design = getUIUXDesign();
  const selectedDesign = getArtifact('selected_ui_style') as UIUXStyleOption | null;
  const selectedStyleName = selectedDesign?.name || null;
  // UI/UX has no per-artifact Approval row of its own (see checkpointStatus.ts) —
  // its review gate is Human Checkpoint 2.
  const approvalStatus = checkpointGateStatus(stages, 'UI/UX Design Agent', 'Human Review 2');

  const handleExport = async (format: 'json' | 'md') => {
    if (!projectId || !design) return;
    try {
      const content = format === 'md'
        ? artifactToMarkdown('UI/UX Design', design as unknown as Record<string, unknown>)
        : JSON.stringify(design, null, 2);
      const blob = new Blob([content], { type: format === 'md' ? 'text/markdown' : 'application/json' });
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

  if (!design && activeTab !== 'studio') {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <Monitor className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm text-text-muted">No UI/UX design generated yet.</p>
          <p className="text-xs text-text-muted mt-1">Run the UI/UX Design Agent, or open the Studio tab to generate one interactively.</p>
          <button onClick={() => setActiveTab('studio')} className="btn-primary text-xs mt-4 mx-auto">Open Design Studio</button>
        </Card>
      </div>
    );
  }

  const emptyDesign: UIUXDesignContent = {
    screens: [], userFlows: [], wireframes: [], componentRecommendations: [], uxRecommendations: [], designSystem: null, styleOptions: [],
  };
  const effectiveDesign = design || emptyDesign;

  const metrics = [
    { label: 'Screens', value: effectiveDesign.screens?.length || 0, icon: Monitor, color: 'text-status-info' },
    { label: 'User Flows', value: effectiveDesign.userFlows?.length || 0, icon: Users, color: 'text-status-success' },
    { label: 'Wireframes', value: effectiveDesign.wireframes?.length || 0, icon: Tablet, color: 'text-status-warning' },
    { label: 'Recommendations', value: (effectiveDesign.componentRecommendations?.length || 0) + (effectiveDesign.uxRecommendations?.length || 0), icon: Zap, color: 'text-ey-yellow' },
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
          <ApprovalBadge status={approvalStatus} />
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

      <ApprovalBanner
        status={approvalStatus}
        note="Review this UI/UX design, then approve Human Checkpoint 2 in the Approval Center."
      />

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
          { id: 'studio', label: 'Studio', icon: Sparkles },
          { id: 'screens', label: 'Screens', icon: Monitor },
          { id: 'flows', label: 'User Flows', icon: Users },
          { id: 'wireframes', label: 'Wireframes', icon: Tablet },
          { id: 'components', label: 'Components', icon: MousePointer },
          { id: 'recommendations', label: 'Recommendations', icon: Zap },
          ...(effectiveDesign.styleOptions?.length ? [{ id: 'styles', label: 'Style Options', icon: Palette }] : []),
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

      {/* Studio tab — interactive design generation/refinement/canvas */}
      {activeTab === 'studio' && (
        <DesignStudio projectId={projectId} design={effectiveDesign} selectedDesign={selectedDesign} reload={reload} />
      )}

      {/* Screens tab */}
      {activeTab === 'screens' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Monitor className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Application Screens</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {effectiveDesign.screens?.map((screen, idx) => (
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
            {effectiveDesign.userFlows?.map((flow, idx) => (
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
            {effectiveDesign.wireframes?.map((wireframe, idx) => (
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
            {effectiveDesign.componentRecommendations?.map((rec, idx) => (
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
            {effectiveDesign.uxRecommendations?.map((rec, idx) => (
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
              ? `"${selectedStyleName}" was selected — Frontend generation builds exactly its screens, navigation, and components, not just its palette and typography.`
              : 'Generated by the UI/UX Agent before Frontend generation began — each is a complete, self-contained design.'}
          </p>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {effectiveDesign.styleOptions?.map((style, idx) => {
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
                  {style.navigation && <p className="text-[10px] text-text-muted mt-1">Navigation: {style.navigation}</p>}
                  {(style.screens?.length ?? 0) > 0 && (
                    <p className="text-[10px] text-text-muted mt-1">{style.screens!.length} screen{style.screens!.length === 1 ? '' : 's'} in this design</p>
                  )}
                  {(style.dataVisualizations?.length ?? 0) > 0 && (
                    <p className="text-[10px] text-text-muted mt-1">Charts/tables: {style.dataVisualizations!.join('; ')}</p>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}