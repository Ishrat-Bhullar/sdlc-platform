/**
 * SDLCPipeline.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Horizontal SDLC pipeline visualisation that consumes
 * GET /projects/{project_id}/pipeline-status from the backend.
 *
 * DROP-IN usage inside Dashboard.tsx:
 *
 *   import { SDLCPipeline } from '../components/SDLCPipeline';
 *   ...
 *   <SDLCPipeline projectId={selectedProjectId} />
 *
 * Props:
 *   projectId  – current selected project id (number | null)
 *   onRefresh  – optional callback so the parent can refresh alongside
 */

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Loader2,
  Clock,
  AlertCircle,
  UserCheck,
  ChevronRight,
  Activity,
  Bot,
  Layers,
  RefreshCw,
} from 'lucide-react';
import { apiRequest } from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StageStatus = 'completed' | 'running' | 'queued' | 'waiting_approval' | 'failed';

export interface PipelineStage {
  key: string;         // matches agent_name from backend
  label: string;       // display label
  status: StageStatus;
}

export interface PipelineStatusResponse {
  completed_stages: number;
  current_stage: string | null;
  current_agent: string | null;
  total_stages: number;
  percentage: number;
  workflow_status: 'idle' | 'running' | 'waiting_approval' | 'completed' | 'failed';
  stages: Array<{
    key: string;
    label: string;
    status: StageStatus;
  }>;
}

// ─── Stage icon map ───────────────────────────────────────────────────────────

function StageIcon({ status, className }: { status: StageStatus; className?: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className={className} />;
    case 'running':
      return <Loader2 className={`${className} animate-spin`} />;
    case 'waiting_approval':
      return <UserCheck className={className} />;
    case 'failed':
      return <AlertCircle className={className} />;
    default:
      return <Clock className={className} />;
  }
}

// ─── Status colour map ────────────────────────────────────────────────────────

const STATUS_STYLES: Record<StageStatus, { badge: string; dot: string; border: string }> = {
  completed:        { badge: 'bg-status-success/15 text-status-success border-status-success/40',    dot: 'bg-status-success',  border: 'border-status-success' },
  running:          { badge: 'bg-status-info/15 text-status-info border-status-info/40',             dot: 'bg-status-info',     border: 'border-status-info' },
  waiting_approval: { badge: 'bg-status-warning/15 text-status-warning border-status-warning/40',    dot: 'bg-status-warning',  border: 'border-status-warning' },
  failed:           { badge: 'bg-status-error/15 text-status-error border-status-error/40',          dot: 'bg-status-error',    border: 'border-status-error' },
  queued:           { badge: 'bg-dark-bg text-text-muted border-dark-border',                        dot: 'bg-dark-border',     border: 'border-dark-border' },
};

const STATUS_LABEL: Record<StageStatus, string> = {
  completed:        'Completed',
  running:          'Running',
  waiting_approval: 'Waiting Approval',
  failed:           'Failed',
  queued:           'Queued',
};

// ─── Single stage node ────────────────────────────────────────────────────────

function StageNode({ stage, active }: { stage: PipelineStage; active: boolean }) {
  const s = STATUS_STYLES[stage.status];
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`
        relative flex flex-col items-center gap-1.5 min-w-[80px] max-w-[96px]
        rounded-xl border px-2.5 py-2.5 text-center transition-all
        ${s.badge}
        ${active ? `ring-2 ring-offset-1 ring-offset-dark-surface ${s.border}` : ''}
      `}
    >
      {/* Status dot */}
      <span className={`absolute -top-1 -right-1 h-2 w-2 rounded-full ${s.dot} ${stage.status === 'running' ? 'animate-pulse' : ''}`} />

      {/* Icon */}
      <StageIcon status={stage.status} className="h-4 w-4" />

      {/* Label */}
      <span className="text-[10px] font-medium leading-tight">{stage.label}</span>

      {/* Status badge */}
      <span className="text-[9px] opacity-75">{STATUS_LABEL[stage.status]}</span>
    </motion.div>
  );
}

// ─── Summary KPI strip ────────────────────────────────────────────────────────

function PipelineKPIs({ data }: { data: PipelineStatusResponse }) {
  const wfColors: Record<string, string> = {
    idle:             'text-text-muted',
    running:          'text-status-info',
    waiting_approval: 'text-status-warning',
    completed:        'text-status-success',
    failed:           'text-status-error',
  };
  const wfLabel: Record<string, string> = {
    idle:             'Idle',
    running:          'Running',
    waiting_approval: 'Waiting Approval',
    completed:        'Completed',
    failed:           'Failed',
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      {/* Current Stage */}
      <div className="rounded-lg bg-dark-bg border border-dark-border px-3 py-2">
        <p className="text-[10px] text-text-muted mb-0.5">Current Stage</p>
        <p className="text-xs font-semibold text-text-primary truncate">
          {data.current_stage || '—'}
        </p>
      </div>

      {/* Running Agent */}
      <div className="rounded-lg bg-dark-bg border border-dark-border px-3 py-2">
        <p className="text-[10px] text-text-muted mb-0.5 flex items-center gap-1">
          <Bot className="h-3 w-3" /> Running Agent
        </p>
        <p className="text-xs font-semibold text-status-info truncate">
          {data.current_agent || '—'}
        </p>
      </div>

      {/* Overall Progress */}
      <div className="rounded-lg bg-dark-bg border border-dark-border px-3 py-2">
        <p className="text-[10px] text-text-muted mb-0.5 flex items-center gap-1">
          <Activity className="h-3 w-3" /> Overall Progress
        </p>
        <p className="text-xs font-bold text-ey-yellow">
          {data.percentage}%
          <span className="text-[10px] font-normal text-text-muted ml-1">
            ({data.completed_stages}/{data.total_stages} stages)
          </span>
        </p>
      </div>

      {/* Workflow Status */}
      <div className="rounded-lg bg-dark-bg border border-dark-border px-3 py-2">
        <p className="text-[10px] text-text-muted mb-0.5">Workflow Status</p>
        <p className={`text-xs font-semibold ${wfColors[data.workflow_status] || 'text-text-primary'}`}>
          {wfLabel[data.workflow_status] || data.workflow_status}
        </p>
      </div>
    </div>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function PipelineProgressBar({ percentage, status }: { percentage: number; status: string }) {
  const barColor =
    status === 'failed'           ? 'bg-status-error'
    : status === 'completed'      ? 'bg-status-success'
    : status === 'waiting_approval' ? 'bg-status-warning'
    : 'bg-ey-yellow';

  return (
    <div className="mb-5">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[10px] text-text-muted">Pipeline completion</span>
        <span className="text-[10px] font-mono text-ey-yellow">{percentage}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-dark-border overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${barColor} transition-all`}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface SDLCPipelineProps {
  projectId: string | number | null;
  /** Called after each successful poll so parent can stay in sync */
  onRefresh?: () => void;
}

export function SDLCPipeline({ projectId, onRefresh }: SDLCPipelineProps) {
  const [data, setData] = useState<PipelineStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await apiRequest<PipelineStatusResponse>(
        `/projects/${projectId}/pipeline-status`
      );
      setData(res);
      setError(null);
      onRefresh?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pipeline status');
    } finally {
      setLoading(false);
    }
  }, [projectId, onRefresh]);

  // Initial load + re-fetch when project changes
  useEffect(() => {
    setData(null);
    fetch();
  }, [fetch]);

  // Auto-poll every 3 s while pipeline is active
  useEffect(() => {
    if (!data) return;
    const active = data.workflow_status === 'running' || data.workflow_status === 'waiting_approval';
    if (!active) return;
    const id = setInterval(fetch, 3000);
    return () => clearInterval(id);
  }, [data, fetch]);

if (!projectId) return null;

  if (!data && loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-ey-yellow" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-status-error/10 border border-status-error/30 px-4 py-3 text-xs text-status-error flex items-center gap-2">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        {error}
        <button
          onClick={fetch}
          className="ml-auto text-[10px] underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  // Show "No pipeline started." when there's no data or empty pipeline
  if (!data || (data.stages && data.stages.length === 0)) {
    return (
      <div className="rounded-lg bg-dark-bg border border-dark-border px-4 py-4 text-xs text-text-muted flex items-center gap-2">
        <Clock className="h-4 w-4 flex-shrink-0" />
        No pipeline started.
      </div>
    );
  }

  return (
    <div>
      {/* Summary KPIs */}
      <PipelineKPIs data={data} />

      {/* Progress bar */}
      <PipelineProgressBar percentage={data.percentage} status={data.workflow_status} />

      {/* Horizontal stage track */}
      <div className="flex items-start gap-1 overflow-x-auto pb-3 -mx-1 px-1">
        {data.stages.map((stage, idx) => (
          <div key={stage.key} className="flex items-start flex-shrink-0">
            <StageNode
              stage={stage}
              active={stage.status === 'running' || stage.status === 'waiting_approval'}
            />
            {idx < data.stages.length - 1 && (
              <div className="flex items-center self-center mx-0.5 mt-[-4px]">
                <ChevronRight className="h-3.5 w-3.5 text-dark-border-light flex-shrink-0" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        {(Object.entries(STATUS_LABEL) as Array<[StageStatus, string]>).map(([s, label]) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${STATUS_STYLES[s].dot}`} />
            <span className="text-[10px] text-text-muted">{label}</span>
          </div>
        ))}
        {loading && (
          <div className="ml-auto flex items-center gap-1 text-[10px] text-text-muted">
            <RefreshCw className="h-3 w-3 animate-spin" /> Syncing…
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Lightweight wrapper card (ready to drop into Dashboard pipeline section) ─

export function SDLCPipelineCard({
  projectId,
  onRefresh,
}: {
  projectId: string | number | null;
  onRefresh?: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Layers className="h-4 w-4 text-ey-yellow" />
        <h3 className="section-title mb-0">SDLC Pipeline</h3>
      </div>
      <SDLCPipeline projectId={projectId} onRefresh={onRefresh} />
    </div>
  );
}

