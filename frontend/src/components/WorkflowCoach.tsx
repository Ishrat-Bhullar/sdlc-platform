import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, X, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useAgentStatus, AGENT_KEY_TO_STAGE_KEY } from '../lib/AgentStatusService';

const STAGE_KEY_TO_ROUTE: Record<string, string> = {
  'Requirement Agent': '/app/requirements',
  'Business Analyst Agent': '/app/business-analyst',
  'Solution Architect Agent': '/app/architecture',
  'Database Design Agent': '/app/database',
  'UI/UX Design Agent': '/app/uiux',
  'Security Architect Agent': '/app/security',
  'Compliance Architect Agent': '/app/compliance',
  'Frontend Agent': '/app/frontend',
  'Backend Agent': '/app/backend',
  'Testing Agent': '/app/testing',
  'Documentation Agent': '/app/documentation',
};

// Human Review 1 gates Requirements + Business Analysis; Human Review 2
// gates Architecture, Database, UI/UX, Security, and Compliance. Both
// checkpoints' own artifacts are already generated and viewable in their
// workspaces by the time the checkpoint itself shows "waiting_approval" —
// this only affects the coaching copy, not which stage is picked.
const CHECKPOINT_GUIDANCE: Record<string, string> = {
  'Human Review 1':
    'Review the generated Requirements and Business Analysis in their workspaces, then go to the Approval Center to approve Human Checkpoint 1.',
  'Human Review 2':
    'Review all generated outputs — Architecture, Database, UI/UX, Security, and Compliance — in their workspaces, then go to the Approval Center to approve Human Checkpoint 2.',
};

// Ported from Bhumika's WorkflowCoach. Rewired: the three localStorage reads
// (ey_design_approved / ey_frontend_agent_status / ey_backend_agent_status)
// are replaced with the real pipeline stage list from useAgentStatus() /
// GET /projects/{id}/pipeline-status; the broken `:contains()` DOM-click
// hack (not valid CSS, always a no-op) is replaced with real route
// navigation.
export function WorkflowCoach() {
  const navigate = useNavigate();
  const { stages, workflowStatus, loading } = useAgentStatus();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || loading || stages.length === 0) return null;
  if (workflowStatus === 'idle') return null;

  const nextStageIdx = stages.findIndex((s) => s.status === 'running' || s.status === 'waiting_approval' || s.status === 'queued');
  const nextStage = nextStageIdx >= 0 ? stages[nextStageIdx] : undefined;
  const upcomingStage = nextStageIdx >= 0 ? stages.slice(nextStageIdx + 1).find((s) => s.status !== 'completed') : undefined;
  const allDone = workflowStatus === 'completed';

  if (!nextStage && !allDone) return null;

  const route = nextStage ? STAGE_KEY_TO_ROUTE[nextStage.key] : null;

  return (
    <div className="fixed bottom-24 right-6 z-40 w-72 bg-dark-card border border-dark-border rounded-2xl shadow-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-ey-yellow" />
          <span className="text-[11px] font-black uppercase tracking-wider text-text-primary">Pipeline Coach</span>
        </div>
        <button onClick={() => setDismissed(true)} className="text-text-muted hover:text-white">
          <X size={14} />
        </button>
      </div>

      {allDone ? (
        <div className="flex items-center gap-2 text-xs text-status-success">
          <CheckCircle2 size={14} />
          <span>Pipeline complete — all stages finished.</span>
        </div>
      ) : (
        <>
          <p className="text-xs text-text-secondary">
            {nextStage?.status === 'waiting_approval'
              ? CHECKPOINT_GUIDANCE[nextStage.key] ||
                `"${nextStage.label}" is generated and awaiting your approval — review it in its workspace, then approve it in the Approval Center.`
              : nextStage?.status === 'running'
                ? `"${nextStage?.label}" is currently running.`
                : `Next up: "${nextStage?.label}".`}
          </p>
          {nextStage?.status === 'waiting_approval' && upcomingStage && (
            <p className="text-[10px] text-text-muted">
              Approving will resume the pipeline — <span className="text-text-secondary">{upcomingStage.label}</span> runs next.
            </p>
          )}
          {route ? (
            <button
              onClick={() => navigate(route)}
              className="w-full flex items-center justify-center gap-1.5 bg-ey-yellow text-black font-bold text-xs px-3 py-2 rounded-lg hover:opacity-90"
            >
              <span>Go to {nextStage?.label}</span>
              <ArrowRight size={12} />
            </button>
          ) : nextStage?.status === 'waiting_approval' ? (
            <button
              onClick={() => navigate('/app/approvals')}
              className="w-full flex items-center justify-center gap-1.5 bg-ey-yellow text-black font-bold text-xs px-3 py-2 rounded-lg hover:opacity-90"
            >
              <span>Go to Approval Center</span>
              <ArrowRight size={12} />
            </button>
          ) : null}
        </>
      )}
      <p className="text-[9px] text-text-muted font-mono">{Object.keys(AGENT_KEY_TO_STAGE_KEY).length} stages tracked</p>
    </div>
  );
}
