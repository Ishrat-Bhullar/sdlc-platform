import { useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { usePipelineUpdates } from '../../hooks/usePipelineUpdates';

/**
 * Shared Regenerate button for agent workspaces. Reuses the exact same
 * mechanism Agent Control Center's per-agent rerun already uses —
 * POST /agents/run?project_id=&agent_name=<exact AgentName enum value>
 * (backend/fastapi_agents/main_extension.py's run_agent_by_name, which
 * calls the unmodified agent_runner.run_agent() — always regenerates a
 * fresh artifact, same as a failed-stage retry) — plus the same
 * usePipelineUpdates WebSocket subscription Agent Control Center uses to
 * learn when the run finishes, instead of polling.
 *
 * `agentName` must be the exact AgentName enum value (e.g. "Requirement
 * Agent", "Frontend Agent") — NOT a snake_case guess. Passing the literal
 * title-case value sidesteps the backend's snake_case normalization
 * entirely (a mismatch there is what silently 404'd Database's old
 * Regenerate button before it was fixed to pass the literal value too).
 */
export function RegenerateButton({
  projectId,
  agentName,
  onRegenerated,
  label = 'Regenerate',
  className = 'btn-ghost text-sm',
  align = 'end',
}: {
  projectId: string;
  agentName: string;
  onRegenerated: () => void | Promise<void>;
  label?: string;
  className?: string;
  align?: 'end' | 'center';
}) {
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  usePipelineUpdates(projectId, (event) => {
    if (!regenerating) return;
    if (event.type === 'agent_completed' && event.data.agent_name === agentName) {
      setRegenerating(false);
      if (event.data.status === 'failed') {
        setError(typeof event.data.error === 'string' ? event.data.error : 'Regeneration failed — check backend logs.');
      } else {
        setError(null);
      }
      onRegenerated();
    }
  });

  const handleClick = async () => {
    setRegenerating(true);
    setError(null);
    try {
      await apiRequest(`/agents/run?project_id=${projectId}&agent_name=${encodeURIComponent(agentName)}`, { method: 'POST' });
      // Deliberately no reload() here — the agent runs asynchronously on the
      // backend; usePipelineUpdates above fires onRegenerated() once the
      // real "agent_completed" WebSocket event for this exact agent arrives.
    } catch (e) {
      setRegenerating(false);
      setError(e instanceof Error ? e.message : 'Failed to start regeneration');
    }
  };

  return (
    <div className={`flex flex-col gap-1 ${align === 'center' ? 'items-center' : 'items-end'}`}>
      <button onClick={handleClick} disabled={regenerating} className={`${className} disabled:opacity-50`}>
        {regenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
        {regenerating ? 'Regenerating…' : label}
      </button>
      {error && <span className="text-[10px] text-status-error max-w-[220px] text-right">{error}</span>}
    </div>
  );
}
