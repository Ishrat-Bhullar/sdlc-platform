/**
 * MonitoringCenter.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Platform Operations — real, cross-project orchestration visibility.
 *
 * This used to be a fully fabricated "system health" dashboard (fake CPU/
 * memory/latency/cost numbers, a hardcoded mock alert feed). This platform's
 * backend doesn't run its own APM, so there is no honest way to show host-
 * level infra metrics. Instead, this page surfaces the real data the backend
 * already tracks: agent-run status platform-wide (GET /dashboard/agents),
 * summary counts (GET /dashboard/summary), and approval governance
 * (GET /dashboard/governance). "Alerts" are real failed AgentRun rows, not
 * fabricated severities.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FolderKanban,
  FileCheck2,
  RefreshCw,
  Bot,
} from 'lucide-react';
import { Card, StatusBadge } from '../components/ui/Card';
import { apiRequest } from '../lib/api';

interface DashboardSummary {
  total_projects: number;
  active_projects: number;
  completed_projects: number;
  total_agent_runs: number;
  running_agents: number;
  completed_agents: number;
  failed_agents: number;
  pending_approvals: number;
  total_artifacts: number;
  total_documents: number;
}

interface DashboardAgentRun {
  id: number;
  project_id: number;
  agent_name: string;
  status: string;
  start_time: string | null;
  end_time: string | null;
  output_url: string | null;
}

interface DashboardGovernance {
  total_approvals: number;
  pending: number;
  approved: number;
  rejected: number;
  published: number;
  recent: Array<{ id: number; project_id: number; artifact_type: string; status: string; comments: string | null }>;
}

interface ProjectSummary {
  id: number;
  name: string;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h ago`;
  return `${Math.round(ms / 86400000)}d ago`;
}

function agentLabel(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function MonitoringCenter() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [agentRuns, setAgentRuns] = useState<DashboardAgentRun[]>([]);
  const [governance, setGovernance] = useState<DashboardGovernance | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, agentsRes, govRes, projectsRes] = await Promise.all([
        apiRequest<DashboardSummary>('/dashboard/summary'),
        apiRequest<DashboardAgentRun[]>('/dashboard/agents'),
        apiRequest<DashboardGovernance>('/dashboard/governance'),
        apiRequest<ProjectSummary[]>('/dashboard/projects'),
      ]);
      setSummary(summaryRes);
      setAgentRuns(agentsRes || []);
      setGovernance(govRes);
      setProjects(projectsRes || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load platform operations data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const projectName = (id: number) => projects.find((p) => p.id === id)?.name || `Project #${id}`;

  const failedRuns = agentRuns.filter((r) => r.status === 'failed');
  const recentRuns = [...agentRuns].sort((a, b) => b.id - a.id).slice(0, 15);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Platform Operations</h1>
          <p className="mt-1 text-sm text-text-muted">Real-time agent execution and approval governance across all projects</p>
        </div>
        <div className="flex items-center gap-3">
          {failedRuns.length > 0 && (
            <StatusBadge status="error">
              <AlertTriangle className="mr-1 h-3 w-3" />
              {failedRuns.length} Failed Run{failedRuns.length === 1 ? '' : 's'}
            </StatusBadge>
          )}
          {summary && (
            <StatusBadge status="success">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              {summary.completed_agents} Completed
            </StatusBadge>
          )}
          <button onClick={load} className="btn-ghost text-sm" disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <Card className="border-status-error/30 bg-status-error/5 text-sm text-status-error">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
            <button onClick={load} className="ml-auto underline hover:no-underline">Retry</button>
          </div>
        </Card>
      )}

      {/* Key Metrics — all real, from GET /dashboard/summary */}
      <div className="grid gap-4 md:grid-cols-6">
        <Card className="text-center">
          <FolderKanban className="h-5 w-5 text-ey-yellow mx-auto mb-2" />
          <p className="text-xl font-bold text-text-primary">{summary?.total_projects ?? '—'}</p>
          <p className="text-[10px] text-text-muted">Projects</p>
        </Card>
        <Card className="text-center">
          <Activity className="h-5 w-5 text-status-info mx-auto mb-2" />
          <p className="text-xl font-bold text-status-info">{summary?.running_agents ?? '—'}</p>
          <p className="text-[10px] text-text-muted">Running Agents</p>
        </Card>
        <Card className="text-center">
          <CheckCircle2 className="h-5 w-5 text-status-success mx-auto mb-2" />
          <p className="text-xl font-bold text-status-success">{summary?.completed_agents ?? '—'}</p>
          <p className="text-[10px] text-text-muted">Completed Runs</p>
        </Card>
        <Card className="text-center">
          <AlertTriangle className="h-5 w-5 text-status-error mx-auto mb-2" />
          <p className="text-xl font-bold text-status-error">{summary?.failed_agents ?? '—'}</p>
          <p className="text-[10px] text-text-muted">Failed Runs</p>
        </Card>
        <Card className="text-center">
          <Clock className="h-5 w-5 text-status-warning mx-auto mb-2" />
          <p className="text-xl font-bold text-status-warning">{summary?.pending_approvals ?? '—'}</p>
          <p className="text-[10px] text-text-muted">Pending Approvals</p>
        </Card>
        <Card className="text-center">
          <FileCheck2 className="h-5 w-5 text-ey-yellow mx-auto mb-2" />
          <p className="text-xl font-bold text-text-primary">{summary?.total_artifacts ?? '—'}</p>
          <p className="text-[10px] text-text-muted">Artifacts Generated</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Agent Activity — real GET /dashboard/agents rows */}
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title mb-0">Recent Agent Activity</h3>
            <span className="text-xs text-text-muted">Across all projects</span>
          </div>
          {recentRuns.length === 0 ? (
            <p className="text-xs text-text-muted py-8 text-center">No agent runs recorded yet.</p>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {recentRuns.map((run) => (
                <div key={run.id} className="flex items-center gap-3 rounded-lg bg-dark-bg p-3">
                  <Bot className={`h-4 w-4 flex-shrink-0 ${
                    run.status === 'completed' ? 'text-status-success'
                    : run.status === 'running' ? 'text-status-info'
                    : run.status === 'failed' ? 'text-status-error'
                    : 'text-text-muted'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text-primary truncate">{agentLabel(run.agent_name)}</p>
                    <p className="text-[10px] text-text-muted truncate">{projectName(run.project_id)} · {formatRelativeTime(run.end_time || run.start_time)}</p>
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
              ))}
            </div>
          )}
        </Card>

        {/* Approval Governance — real GET /dashboard/governance */}
        <Card>
          <h3 className="section-title">Approval Governance</h3>
          {governance ? (
            <>
              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">Pending</span>
                  <span className="text-status-warning font-medium">{governance.pending}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">Approved</span>
                  <span className="text-status-success font-medium">{governance.approved}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">Rejected</span>
                  <span className="text-status-error font-medium">{governance.rejected}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">Published</span>
                  <span className="text-text-primary font-medium">{governance.published}</span>
                </div>
              </div>
              <div className="pt-3 border-t border-dark-border">
                <p className="text-[10px] text-text-muted uppercase tracking-wide mb-2">Recent decisions</p>
                {governance.recent.length === 0 ? (
                  <p className="text-xs text-text-muted">No approvals recorded yet.</p>
                ) : (
                  <div className="space-y-2 max-h-[220px] overflow-y-auto">
                    {governance.recent.map((a) => (
                      <div key={a.id} className="text-xs">
                        <p className="text-text-primary">{a.artifact_type.replace(/_/g, ' ')}</p>
                        <p className="text-[10px] text-text-muted">{projectName(a.project_id)} · {a.status}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-text-muted">Loading…</p>
          )}
        </Card>
      </div>

      {/* Failed runs — real alerts, no fabricated severities */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title mb-0">Failed Runs</h3>
          <span className="text-xs text-text-muted">{failedRuns.length} total</span>
        </div>
        {failedRuns.length === 0 ? (
          <p className="text-xs text-text-muted py-8 text-center">No failed agent runs — everything is healthy.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {failedRuns.map((run) => (
              <div key={run.id} className="flex items-center gap-4 rounded-lg p-3 bg-status-error/5 border border-status-error/20">
                <AlertTriangle className="h-5 w-5 text-status-error flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary">{agentLabel(run.agent_name)} failed — {projectName(run.project_id)}</p>
                  <p className="text-[10px] text-text-muted mt-0.5 truncate">{run.output_url || 'No error detail recorded'}</p>
                </div>
                <span className="text-[10px] text-text-muted flex-shrink-0">{formatRelativeTime(run.end_time || run.start_time)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
