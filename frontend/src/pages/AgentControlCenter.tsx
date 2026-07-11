import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Activity,
  Clock,
  RefreshCw,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  RotateCcw,
  PlayCircle,
  FileSearch,
  Briefcase,
  Building2,
  Database,
  Monitor,
  Server,
  TestTube,
  Shield,
  FileCheck2,
  FileText,
  X,
  Brain,
  AlertTriangle,
} from 'lucide-react';
import { Card, StatusBadge } from '../components/ui/Card';
import { apiRequest } from '../lib/api';
import { getSelectedProjectId } from '../lib/projectContext';
import { usePipelineUpdates } from '../hooks/usePipelineUpdates';
import { friendlyErrorMessage } from '../lib/friendlyError';

// Matches GET /projects/{id}/agent-runs exactly (backend/fastapi_agents/main_extension.py) —
// RunStatus is "pending" | "running" | "completed" | "failed"; agent_name is the
// human-readable AgentName enum value (e.g. "Frontend Agent"), already in pipeline order.
interface AgentRunStatus {
  id: number;
  project_id: number;
  agent_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  start_time: string | null;
  end_time: string | null;
  output_url: string | null;
}

function stageIcon(status: AgentRunStatus['status']) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-status-success" />;
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-status-error" />;
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 text-status-info animate-spin" />;
  return <Clock className="h-3.5 w-3.5 text-text-muted" />;
}

function agentIconFor(name: string) {
  const n = name.toLowerCase();
  if (n.includes('memory')) return Brain;
  if (n.includes('requirement')) return FileSearch;
  if (n.includes('business analyst')) return Briefcase;
  if (n.includes('architect')) return Building2;
  if (n.includes('database')) return Database;
  if (n.includes('ui/ux') || n.includes('ui-ux')) return Monitor;
  if (n.includes('security')) return Shield;
  if (n.includes('compliance')) return FileCheck2;
  if (n.includes('review')) return CheckCircle2;
  if (n.includes('frontend')) return Monitor;
  if (n.includes('backend')) return Server;
  if (n.includes('testing')) return TestTube;
  if (n.includes('documentation')) return FileText;
  return Bot;
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return '—';
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Shared real data source — GET /projects/{id}/agent-runs, kept live via
 *  the same WebSocket pipeline-event stream Dashboard/DevelopmentStudio use. */
function useAgentRuns(projectId: string | null) {
  const [runs, setRuns] = useState<AgentRunStatus[] | null>(null);

  const load = useCallback(async () => {
    if (!projectId) { setRuns(null); return; }
    try {
      const data = await apiRequest<AgentRunStatus[]>(`/projects/${projectId}/agent-runs`);
      setRuns(data);
    } catch {
      setRuns(null);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  usePipelineUpdates(projectId, () => { load(); });

  return { runs, load };
}

function PipelineCheckpointsCard({ runs, load }: { runs: AgentRunStatus[] | null; load: () => Promise<void> }) {
  const [projectId] = useState(() => getSelectedProjectId());
  const [actionState, setActionState] = useState<'idle' | 'resuming' | 'restarting'>('idle');
  const [actionError, setActionError] = useState<string | null>(null);

  const handleResume = async () => {
    if (!projectId) return;
    setActionState('resuming');
    setActionError(null);
    try {
      // The real pipeline (agent_runner.run_pipeline) already skips
      // completed stages and reuses any artifact a previously-failed stage
      // already produced — re-triggering it is exactly "resume".
      await apiRequest(`/projects/${projectId}/pipeline/trigger`, { method: 'POST' });
      setTimeout(load, 1000);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to resume pipeline');
    } finally {
      setActionState('idle');
    }
  };

  const handleRestart = async () => {
    if (!projectId) return;
    setActionState('restarting');
    setActionError(null);
    try {
      await apiRequest(`/projects/${projectId}/pipeline/reset`, { method: 'POST' });
      await apiRequest(`/projects/${projectId}/pipeline/trigger`, { method: 'POST' });
      setTimeout(load, 1000);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to restart pipeline');
    } finally {
      setActionState('idle');
    }
  };

  if (!projectId) {
    return (
      <Card>
        <h3 className="section-title mb-1">Pipeline Checkpoints</h3>
        <p className="text-xs text-text-muted">Select a project in the Dashboard to view checkpoint status.</p>
      </Card>
    );
  }

  const hasFailed = runs?.some((r) => r.status === 'failed') ?? false;
  const lastCompleted = runs ? [...runs].reverse().find((r) => r.status === 'completed') : null;
  const firstFailed = runs?.find((r) => r.status === 'failed');
  const completedCount = runs?.filter((r) => r.status === 'completed').length ?? 0;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="section-title mb-0">Pipeline Checkpoints</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleResume}
            disabled={!hasFailed || actionState !== 'idle'}
            className="btn-ghost text-xs flex items-center disabled:opacity-40"
            title={!hasFailed ? 'No failed stage to resume from' : 'Retry the failed stage and continue from there'}
          >
            {actionState === 'resuming' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <PlayCircle className="mr-1 h-3 w-3" />}
            Resume
          </button>
          <button
            onClick={handleRestart}
            disabled={actionState !== 'idle' || !runs?.length}
            className="btn-ghost text-xs flex items-center disabled:opacity-40"
            title="Restart the entire pipeline from Memory"
          >
            {actionState === 'restarting' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />}
            Restart
          </button>
        </div>
      </div>

      {actionError && <div className="mb-3 text-xs text-status-error">{actionError}</div>}

      {!runs || !runs.length ? (
        <p className="text-xs text-text-muted">No pipeline runs yet for this project.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            {runs.map((run) => (
              <div
                key={run.id}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] border ${
                  run.status === 'completed' ? 'border-status-success/30 bg-status-success/10 text-status-success' :
                  run.status === 'failed' ? 'border-status-error/30 bg-status-error/10 text-status-error' :
                  run.status === 'running' ? 'border-status-info/30 bg-status-info/10 text-status-info' :
                  'border-dark-border bg-dark-bg text-text-muted'
                }`}
              >
                {stageIcon(run.status)}
                {run.agent_name}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
            <span>Last completed: <span className="text-text-primary">{lastCompleted?.agent_name || '—'}</span></span>
            <span>{firstFailed ? 'Failed at' : 'Status'}: <span className={firstFailed ? 'text-status-error' : 'text-text-primary'}>{firstFailed?.agent_name || (completedCount === runs.length ? 'Completed' : 'In progress')}</span></span>
            <span>{completedCount}/{runs.length} stages</span>
          </div>
        </>
      )}
    </Card>
  );
}

export function AgentControlCenter() {
  const [projectId] = useState(() => getSelectedProjectId());
  const { runs, load } = useAgentRuns(projectId);
  const [selectedRun, setSelectedRun] = useState<AgentRunStatus | null>(null);
  const [restarting, setRestarting] = useState(false);

  const runList = runs || [];
  const runningCount = runList.filter((r) => r.status === 'running').length;
  const queuedCount = runList.filter((r) => r.status === 'pending').length;
  const completedCount = runList.filter((r) => r.status === 'completed').length;
  const failedCount = runList.filter((r) => r.status === 'failed').length;

  const handleRestartAgent = async (run: AgentRunStatus) => {
    if (!projectId) return;
    setRestarting(true);
    try {
      await apiRequest(`/agents/run?project_id=${projectId}&agent_name=${encodeURIComponent(run.agent_name)}`, { method: 'POST' });
      await load();
      setSelectedRun(null);
    } catch (e) {
      console.error('Failed to restart agent:', e);
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Agent Control Center</h1>
          <p className="mt-1 text-sm text-text-muted">Real-time orchestration status for the selected project's agent pipeline</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="btn-ghost text-sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Status
          </button>
        </div>
      </div>

      {!projectId ? (
        <Card className="py-10 text-center">
          <AlertTriangle className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">No project selected</p>
          <p className="text-xs text-text-muted mt-1">Select a project in the Dashboard to view agent status.</p>
        </Card>
      ) : (
        <>
          {/* Pipeline Checkpoints */}
          <PipelineCheckpointsCard runs={runs} load={load} />

          {/* Top Metrics — all real, derived from the same agent-runs rows */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="text-center">
              <Bot className="h-6 w-6 text-ey-yellow mx-auto mb-2" />
              <p className="text-2xl font-bold text-text-primary">{runList.length}</p>
              <p className="text-xs text-text-muted">Total Stages</p>
            </Card>
            <Card className="text-center">
              <Activity className="h-6 w-6 text-status-info mx-auto mb-2" />
              <p className="text-2xl font-bold text-status-info">{runningCount}</p>
              <p className="text-xs text-text-muted">Running</p>
            </Card>
            <Card className="text-center">
              <Clock className="h-6 w-6 text-status-warning mx-auto mb-2" />
              <p className="text-2xl font-bold text-status-warning">{queuedCount}</p>
              <p className="text-xs text-text-muted">Queued</p>
            </Card>
            <Card className="text-center">
              <CheckCircle2 className="h-6 w-6 text-status-success mx-auto mb-2" />
              <p className="text-2xl font-bold text-status-success">{completedCount}</p>
              <p className="text-xs text-text-muted">Completed</p>
            </Card>
          </div>

          {/* Agent Fleet Table — real rows, real statuses, real durations */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="section-title mb-0">Agent Fleet</h3>
              <span className="text-xs text-text-muted">{failedCount > 0 ? `${failedCount} failed` : 'All stages healthy'}</span>
            </div>
            {runList.length === 0 ? (
              <p className="text-xs text-text-muted py-8 text-center">No agent runs recorded for this project yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-dark-border">
                      <th className="text-left text-xs font-medium text-text-muted pb-3">Agent</th>
                      <th className="text-left text-xs font-medium text-text-muted pb-3">Status</th>
                      <th className="text-left text-xs font-medium text-text-muted pb-3">Started</th>
                      <th className="text-left text-xs font-medium text-text-muted pb-3">Duration</th>
                      <th className="text-left text-xs font-medium text-text-muted pb-3">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runList.map((run) => {
                      const Icon = agentIconFor(run.agent_name);
                      return (
                        <tr
                          key={run.id}
                          className="border-b border-dark-border/50 hover:bg-dark-cardHover cursor-pointer transition-colors"
                          onClick={() => setSelectedRun(run)}
                        >
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                                run.status === 'running' ? 'bg-status-info/10' :
                                run.status === 'completed' ? 'bg-status-success/10' :
                                run.status === 'failed' ? 'bg-status-error/10' :
                                'bg-dark-bg'
                              }`}>
                                <Icon className={`h-4 w-4 ${
                                  run.status === 'running' ? 'text-status-info' :
                                  run.status === 'completed' ? 'text-status-success' :
                                  run.status === 'failed' ? 'text-status-error' :
                                  'text-text-muted'
                                }`} />
                              </div>
                              <span className="text-sm font-medium text-text-primary">{run.agent_name}</span>
                            </div>
                          </td>
                          <td className="py-3">
                            <StatusBadge status={
                              run.status === 'running' ? 'running' :
                              run.status === 'completed' ? 'success' :
                              run.status === 'failed' ? 'error' : 'pending'
                            }>
                              {run.status}
                            </StatusBadge>
                          </td>
                          <td className="py-3">
                            <span className="text-xs text-text-secondary">
                              {run.start_time ? new Date(run.start_time).toLocaleTimeString() : '—'}
                            </span>
                          </td>
                          <td className="py-3">
                            <span className="text-xs text-text-secondary">{formatDuration(run.start_time, run.end_time)}</span>
                          </td>
                          <td className="py-3">
                            <button className="btn-ghost text-xs" onClick={(e) => { e.stopPropagation(); setSelectedRun(run); }}>
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* Run Detail Modal — real AgentRunStatus fields only */}
      <AnimatePresence>
        {selectedRun && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-dark-bg/80 backdrop-blur-sm"
            onClick={() => setSelectedRun(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-dark-card border border-dark-border rounded-lg w-full max-w-lg max-h-[80vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-dark-border p-4">
                <div className="flex items-center gap-3">
                  {(() => {
                    const Icon = agentIconFor(selectedRun.agent_name);
                    return (
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                        selectedRun.status === 'running' ? 'bg-status-info/10' :
                        selectedRun.status === 'completed' ? 'bg-status-success/10' :
                        selectedRun.status === 'failed' ? 'bg-status-error/10' :
                        'bg-dark-bg'
                      }`}>
                        <Icon className={`h-5 w-5 ${
                          selectedRun.status === 'running' ? 'text-status-info' :
                          selectedRun.status === 'completed' ? 'text-status-success' :
                          selectedRun.status === 'failed' ? 'text-status-error' :
                          'text-text-muted'
                        }`} />
                      </div>
                    );
                  })()}
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary">{selectedRun.agent_name}</h3>
                    <p className="text-xs text-text-muted">Run ID: {selectedRun.id}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedRun(null)}
                  className="rounded-lg p-2 text-text-muted hover:bg-dark-bg hover:text-text-primary"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-4 overflow-y-auto space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center rounded-lg bg-dark-bg p-3">
                    <StatusBadge status={
                      selectedRun.status === 'running' ? 'running' :
                      selectedRun.status === 'completed' ? 'success' :
                      selectedRun.status === 'failed' ? 'error' : 'pending'
                    }>
                      {selectedRun.status}
                    </StatusBadge>
                  </div>
                  <div className="text-center rounded-lg bg-dark-bg p-3">
                    <p className="text-sm font-semibold text-text-primary">{selectedRun.start_time ? new Date(selectedRun.start_time).toLocaleTimeString() : '—'}</p>
                    <p className="text-[10px] text-text-muted">Started</p>
                  </div>
                  <div className="text-center rounded-lg bg-dark-bg p-3">
                    <p className="text-sm font-semibold text-text-primary">{formatDuration(selectedRun.start_time, selectedRun.end_time)}</p>
                    <p className="text-[10px] text-text-muted">Duration</p>
                  </div>
                </div>

                {selectedRun.status === 'failed' && (
                  <div className="rounded-lg border border-status-error/30 bg-status-error/5 p-3">
                    <p className="text-xs font-medium text-status-error mb-1">Failure</p>
                    <p className="text-xs text-text-secondary">{friendlyErrorMessage(selectedRun.output_url)}</p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-dark-border p-4">
                <button
                  onClick={() => handleRestartAgent(selectedRun)}
                  disabled={restarting || selectedRun.status === 'running'}
                  className="btn-secondary text-sm disabled:opacity-50"
                >
                  {restarting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                  Re-run this stage
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
