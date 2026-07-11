import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { SDLCPipelineCard } from '../components/Sdlcpipeline';
import { ArchitectureDiagramViewer, DiagramData } from '../components/ArchitectureDiagramViewer';
import { useToast } from '../components/ui/Toast';
import { usePipelineUpdates } from '../hooks/usePipelineUpdates';

import {
  FolderKanban,
  Bot,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Activity,
  RefreshCw,
  FileText,
  Building2,
  Loader2,
  BarChart3,
  Timer,
  Calendar,
  Package,
  FileSearch,
  Briefcase,
  Play,
  Square,
  Video,
} from 'lucide-react';
import { Card, StatusBadge } from '../components/ui/Card';
import { apiRequest, buildApiUrl } from '../lib/api';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId as getSavedProjectId, setSelectedProjectId as persistSelectedProjectId } from '../lib/projectContext';
import { friendlyErrorMessage } from '../lib/friendlyError';
import type { DashboardSummary, AgentRun, Artifact } from '../types/unified';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const ms = e - s;
  if (ms < 1000) return '<1s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

// Backend stores the raw exception text in output_url as {"error": "..."} on
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Memoized Sub-components ──────────────────────────────────────────────────

const AgentRunRow = memo(function AgentRunRow({ run }: { run: AgentRun }) {
  const colorClass = run.status === 'completed' ? 'text-status-success border-status-success bg-status-success/10'
    : run.status === 'running' ? 'text-status-info border-status-info bg-status-info/10'
    : run.status === 'failed' ? 'text-status-error border-status-error bg-status-error/10'
    : 'text-text-muted border-dark-border bg-dark-bg';
  const barColor = run.status === 'completed' ? 'bg-status-success'
    : run.status === 'running' ? 'bg-status-info'
    : run.status === 'failed' ? 'bg-status-error'
    : 'bg-dark-border';
  const duration = formatDuration(run.start_time, run.end_time);
  const isRunning = run.status === 'running';
  // Terminal states (completed/failed) show a full bar as a real completion
  // indicator. Running has no backend-tracked per-run progress percentage —
  // showing an indeterminate sweep instead of a fabricated number.

  return (
    <div className="rounded-lg bg-dark-bg p-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${colorClass}`}>
          <Bot className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-text-primary truncate">
            {run.agent_name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </p>
          {run.status === 'failed' && (
            <p className="text-[10px] text-status-error truncate">
              {friendlyErrorMessage(run.output_url)}
            </p>
          )}
        </div>
        <StatusBadge status={
          run.status === 'completed' ? 'success'
          : run.status === 'running' ? 'running'
          : run.status === 'failed' ? 'error'
          : 'idle'
        }>
          {run.status}
        </StatusBadge>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-dark-border overflow-hidden relative">
          {isRunning ? (
            <div className={`absolute inset-y-0 left-0 w-1/3 rounded-full ${barColor} animate-[indeterminate_1.2s_ease-in-out_infinite]`} />
          ) : (
            <div className={`h-full rounded-full ${barColor}`} style={{ width: (run.status === 'completed' || run.status === 'failed') ? '100%' : '0%' }} />
          )}
        </div>
        {!isRunning && (
          <span className="text-[10px] font-mono text-text-muted w-8 text-right">
            {run.status === 'completed' || run.status === 'failed' ? '100%' : '—'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-[10px] text-text-muted">
        {duration && <span className="flex items-center gap-1"><Timer className="h-3 w-3" />{duration}</span>}
        {run.start_time && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatTimestamp(run.start_time)}</span>}
      </div>
    </div>
  );
});

const ArtifactPreviewCard = memo(function ArtifactPreviewCard({ artifact }: { artifact: Artifact }) {
  const contentStr = typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content);
  const bytes = new TextEncoder().encode(contentStr).length;
  const kb = (bytes / 1024).toFixed(1);
  return (
    <div className="rounded-lg bg-dark-bg p-3">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="h-4 w-4 text-ey-yellow" />
        <span className="text-xs font-medium text-text-primary flex-1 truncate">{artifact.artifact_type}</span>
        <StatusBadge status="success">{kb} KB</StatusBadge>
      </div>
      <p className="text-[10px] text-text-muted">{new Date(artifact.created_at).toLocaleString()}</p>
    </div>
  );
});

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function Dashboard() {
  const location = useLocation();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string; description?: string; status?: string }[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
    const statePid = location.state?.projectId;
    if (statePid) {
      return typeof statePid === 'number' ? String(statePid) : statePid;
    }
    return getSavedProjectId();
  });

  // Persisting (and thus broadcasting the project-change event) is a side
  // effect — it must not run inside the useState initializer above, which
  // fires synchronously during render. Ancestor components (AgentStatusProvider,
  // GlobalLoadingProvider) subscribe to that event and call setState in
  // response, which React flags as "Cannot update a component while
  // rendering a different component" when triggered from render.
  useEffect(() => {
    const statePid = location.state?.projectId;
    if (statePid) {
      persistSelectedProjectId(typeof statePid === 'number' ? String(statePid) : statePid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { addToast } = useToast();

  const projectIdRef = useRef(selectedProjectId);
  projectIdRef.current = selectedProjectId;

  const { artifacts, loading: artifactsLoading, getArchitecture, downloadArtifact } = useUnifiedArtifacts(selectedProjectId);

  const fetchAll = useCallback(async () => {
    try {
      setLoadError(null);
      const [sum, projsRaw] = await Promise.all([
        apiRequest<DashboardSummary>('/dashboard/summary'),
        apiRequest<{ projects?: { id: string; name: string; description?: string; status?: string }[] } | { id: string; name: string; description?: string; status?: string }[]>('/projects'),
      ]);

      setSummary(sum);
      // FastAPI returns array directly; Node.js returns { projects: [] }
      const projsList = Array.isArray(projsRaw) ? projsRaw : ((projsRaw as any)?.projects || []);
      setProjects(projsList);

      const savedPid = getSavedProjectId();
      const candidatePid = savedPid ?? (projsList.length ? projsList[0].id : null);
      const validPid = projsList.some((p: any) => String(p.id) === String(candidatePid))
        ? String(candidatePid)
        : (projsList.length ? String(projsList[0].id) : null);

      if (validPid) {
        setSelectedProjectId(validPid);
        persistSelectedProjectId(validPid);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Dashboard data could not be loaded');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!selectedProjectId) {
      setAgentRuns([]);
      return;
    }
    apiRequest<any[]>(`/dashboard/agents?project_id=${selectedProjectId}`)
      .then((runs) => setAgentRuns((runs || []).map((run) => ({
        ...run,
        agent_key: run.agent_key || (run.agent_type === 'presentation-video'
          ? 'presentation_video_agent'
          : String(run.agent_type || '').replace(/-/g, '_')),
      }))))
      .catch(() => setAgentRuns([]));
  }, [selectedProjectId]);

  const selectProject = useCallback(async (pid: string) => {
    setSelectedProjectId(pid);
    persistSelectedProjectId(pid);
  }, []);

  const handleDownloadAll = useCallback(async () => {
    if (!selectedProjectId) return;
    const toastId = addToast('Preparing deliverables bundle…', 'loading', 0);
    try {
      const url = buildApiUrl(`/documents/export-all?project_id=${selectedProjectId}`);
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      downloadBlob(blob, `ey_sdlc_export_${selectedProjectId}.zip`);
      addToast('All deliverables downloaded successfully', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to download deliverables', 'error');
    }
  }, [selectedProjectId, addToast]);

  const handleWsEvent = useCallback((event: { type: string; data: Record<string, unknown> }) => {
    const { type, data } = event;
    if (type === 'agent_completed' || type === 'agent_started') {
      const run = data as Partial<AgentRun>;
      setAgentRuns((prev: AgentRun[]) => {
        const idx = prev.findIndex((r: AgentRun) => r.id === (run.id as string));
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...run } as AgentRun;
          return next;
        }
        return prev;
      });
    } else if (type === 'artifact_generated') {
      // Artifacts are managed by useUnifiedArtifacts hook
    } else if (type === 'approval_requested') {
      // Summary will be refreshed on next poll
    }
  }, []);

  usePipelineUpdates(projectIdRef, handleWsEvent);

  const archData = getArchitecture();
  const diagrams: DiagramData[] = archData?.diagrams || [];

  const totalAgents = agentRuns.length;
  const completedAgents = agentRuns.filter((r) => r.status === 'completed').length;
  const runningAgents = agentRuns.filter((r) => r.status === 'running').length;
  const failedAgents = agentRuns.filter((r) => r.status === 'failed').length;
  const pipelinePct = totalAgents > 0 ? Math.round((completedAgents / totalAgents) * 100) : 0;

  const kpis = useMemo(() => [
    { label: 'Projects', value: summary?.total_projects ?? projects.length, icon: <FolderKanban className="h-5 w-5" />, color: 'text-ey-yellow' },
    { label: 'Running Agents', value: summary?.running_agents ?? runningAgents, icon: <Activity className="h-5 w-5" />, color: 'text-status-info' },
    { label: 'Completed', value: summary?.completed_agents ?? completedAgents, icon: <CheckCircle2 className="h-5 w-5" />, color: 'text-status-success' },
    { label: 'Artifacts', value: summary?.total_artifacts ?? artifacts.length, icon: <FileText className="h-5 w-5" />, color: 'text-status-success' },
    { label: 'Pending Approvals', value: summary?.pending_approvals ?? 0, icon: <Clock className="h-5 w-5" />, color: 'text-status-warning' },
    { label: 'Failed Agents', value: summary?.failed_agents ?? failedAgents, icon: <AlertTriangle className="h-5 w-5" />, color: 'text-status-error' },
  ], [summary, projects.length, runningAgents, completedAgents, artifacts.length, failedAgents]);

  const runByAgent = useMemo(() => {
    const map: Record<string, AgentRun> = {};
    agentRuns.forEach((r) => { map[r.agent_key || r.agent_name] = r; });
    return map;
  }, [agentRuns]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-ey-yellow" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Orchestration Dashboard</h1>
          <p className="mt-1 text-sm text-text-muted">
            Executive overview · {new Date().toLocaleTimeString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleDownloadAll} disabled={!selectedProjectId} className="btn-ghost text-sm" title="Download all deliverables as a ZIP bundle">
            <Package className="mr-2 h-4 w-4" />
            Download All
          </button>
          <button onClick={fetchAll} className="btn-ghost text-sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {loadError && (
        <Card className="border-status-error/30 bg-status-error/5 text-sm text-status-error">
          Unable to load dashboard: {loadError}
        </Card>
      )}

      {/* KPI strip */}
      <div className="grid gap-3 md:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.label} className="text-center py-3">
            <div className={`mx-auto mb-1 ${k.color}`}>{k.icon}</div>
            <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-[10px] text-text-muted">{k.label}</p>
          </Card>
        ))}
      </div>

      {/* Project selector */}
      {projects.length > 0 && (
        <Card>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-medium text-text-muted">Project:</span>
            {projects.map((p) => (
              <button key={p.id} onClick={() => selectProject(p.id)} className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                selectedProjectId === p.id ? 'border-ey-yellow bg-ey-yellow/10 text-ey-yellow' : 'border-dark-border text-text-secondary hover:border-dark-border-light'
              }`}>
                {p.name}
              </button>
            ))}
          </div>
        </Card>
      )}

      {projects.length === 0 && (
        <Card className="py-10 text-center">
          <FolderKanban className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">No projects yet</p>
          <p className="text-xs text-text-muted mt-1">Create a project from the Projects page to see the pipeline here.</p>
        </Card>
      )}

      {selectedProjectId && (
        <Card>
          <SDLCPipelineCard projectId={selectedProjectId} onRefresh={fetchAll} />
        </Card>
      )}

      {/* Pipeline progress bar */}
      {totalAgents > 0 && (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-4 w-4 text-ey-yellow" />
            <h3 className="section-title mb-0">Pipeline Progress</h3>
            <span className="text-xs font-mono text-ey-yellow ml-auto">{pipelinePct}%</span>
          </div>
          <div className="h-2 rounded-full bg-dark-border overflow-hidden">
            <div className="h-full rounded-full bg-ey-yellow transition-all duration-700" style={{ width: `${pipelinePct}%` }} />
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-text-muted">
            <span>{completedAgents} of {totalAgents} stages completed</span>
            <span>{runningAgents} running · {failedAgents} failed</span>
          </div>
        </Card>
      )}

      {/* Agent status with progress bars */}
      <Card>
        <h3 className="section-title">Agent Execution History</h3>
        {agentRuns.length === 0 ? (
          <p className="text-xs text-text-muted">No agents have run yet for this project.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {agentRuns.map((run) => (
              <AgentRunRow key={run.id} run={run} />
            ))}
          </div>
        )}
      </Card>

      {/* Artifact preview cards */}
      <Card>
        <h3 className="section-title">Generated Artifacts</h3>
        {artifacts.length === 0 ? (
          <p className="text-xs text-text-muted">No artifacts generated yet.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {artifacts.map((art) => (
              <ArtifactPreviewCard key={art.id} artifact={art} />
            ))}
          </div>
        )}
      </Card>

      {/* Architecture preview */}
      {archData && (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="h-4 w-4 text-ey-yellow" />
            <h3 className="section-title mb-0">Architecture Preview</h3>
            <StatusBadge status="success">Generated</StatusBadge>
          </div>
          {archData.pattern != null && (
            <p className="text-xs text-text-secondary mb-2">Pattern: <span className="font-medium text-ey-yellow">{String(archData.pattern)}</span></p>
          )}
          {diagrams.length > 0 && (
            <ArchitectureDiagramViewer diagrams={diagrams} />
          )}
        </Card>
      )}

      {/* Video Agent Status Card */}
      {selectedProjectId && (
        <Card>
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
              runByAgent['presentation_video_agent']?.status === 'completed' ? 'bg-status-success/10 text-status-success'
              : runByAgent['presentation_video_agent']?.status === 'running' ? 'bg-status-info/10 text-status-info'
              : runByAgent['presentation_video_agent']?.status === 'failed' ? 'bg-status-error/10 text-status-error'
              : 'bg-dark-bg text-text-muted'
            }`}>
              <Video className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-text-primary">Presentation & Video Generation</h3>
              <p className="text-xs text-text-muted">
                {!runByAgent['presentation_video_agent'] ? 'No presentation generated.'
                  : runByAgent['presentation_video_agent'].status === 'completed' ? 'Completed'
                  : runByAgent['presentation_video_agent'].status === 'running' ? 'Generating presentation and video…'
                  : runByAgent['presentation_video_agent'].status === 'failed' ? 'Failed'
                  : 'Pending'}
              </p>
            </div>
            <StatusBadge status={
              !runByAgent['presentation_video_agent'] ? 'idle'
              : runByAgent['presentation_video_agent'].status === 'completed' ? 'success'
              : runByAgent['presentation_video_agent'].status === 'running' ? 'running'
              : runByAgent['presentation_video_agent'].status === 'failed' ? 'error'
              : 'idle'
            }>
              {!runByAgent['presentation_video_agent'] ? 'idle' : runByAgent['presentation_video_agent'].status}
            </StatusBadge>
          </div>
        </Card>
      )}
    </div>
  );
}

export {};
