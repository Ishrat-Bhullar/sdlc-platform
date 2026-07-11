import type { PipelineStage } from './AgentStatusService';

/**
 * A handful of agent stages (UI/UX, Security) have no per-artifact Approval
 * row of their own — backend/fastapi_agents/agent_runner.py's _AGENT_CONFIG
 * sets `"approval": False` for them, so getApprovalStatus() always returns
 * null. Their real-world review gate is the downstream Human Review
 * checkpoint that blocks pipeline progression instead. This derives an
 * ApprovalBadge/ApprovalBanner-compatible pseudo-status ('Approved' /
 * 'Pending Approval' / null) from the existing, unmodified pipeline-status
 * stage list so those workspaces can show the same "awaiting approval"
 * treatment without inventing any new backend state.
 */
export function checkpointGateStatus(
  stages: PipelineStage[],
  ownStageKey: string,
  checkpointStageKey: string
): string | null {
  const own = stages.find((s) => s.key === ownStageKey);
  if (!own || own.status !== 'completed') return null; // nothing generated yet, or still running/failed
  const checkpoint = stages.find((s) => s.key === checkpointStageKey);
  if (!checkpoint) return null;
  return checkpoint.status === 'completed' ? 'Approved' : 'Pending Approval';
}
