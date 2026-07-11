import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiRequest } from './api';
import { getSelectedProjectId, subscribeToSelectedProject } from './projectContext';

export type AgentStatus = 'completed' | 'running' | 'queued' | 'waiting_approval' | 'failed' | 'idle';

export interface PipelineStage {
  key: string;
  label: string;
  status: string;
}

interface PipelineStatusResponse {
  completed_stages: number;
  current_stage: string | null;
  current_agent: string | null;
  total_stages: number;
  percentage: number;
  workflow_status: string;
  stages: PipelineStage[];
}

// Maps MainLayout nav agentKey -> the exact pipeline stage key the backend
// emits (== AgentName enum values in backend/fastapi_agents/models.py, same
// strings agent_runner.py's PIPELINE list uses). Ported from Bhumika's
// AGENT_TO_ARTIFACT_MAP, but keyed against real pipeline-status stage keys
// instead of guessed artifact_type strings (her GET /projects/{id}/artifacts
// call didn't exist on any backend — this uses the real, already-working
// GET /projects/{id}/pipeline-status endpoint instead).
export const AGENT_KEY_TO_STAGE_KEY: Record<string, string> = {
  requirement: 'Requirement Agent',
  'business-analyst': 'Business Analyst Agent',
  architect: 'Solution Architect Agent',
  database: 'Database Design Agent',
  uiux: 'UI/UX Design Agent',
  security: 'Security Architect Agent',
  compliance: 'Compliance Architect Agent',
  frontend: 'Frontend Agent',
  backend: 'Backend Agent',
  testing: 'Testing Agent',
  documentation: 'Documentation Agent',
};

function mapStageStatus(status: string | undefined): AgentStatus {
  switch (status) {
    case 'completed':
    case 'running':
    case 'failed':
    case 'waiting_approval':
    case 'queued':
      return status;
    default:
      return 'idle';
  }
}

interface AgentStatusContextValue {
  statuses: Record<string, AgentStatus>;
  getAgentStatus: (agentKey: string) => AgentStatus;
  refreshStatuses: () => Promise<void>;
  loading: boolean;
  currentStage: string | null;
  workflowStatus: string;
  percentage: number;
  stages: PipelineStage[];
}

const AgentStatusContext = createContext<AgentStatusContextValue | undefined>(undefined);

export function AgentStatusProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectId] = useState<string | null>(() => getSelectedProjectId());
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<string>('idle');
  const [percentage, setPercentage] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const refreshStatuses = useCallback(async () => {
    if (!projectId) {
      setStages([]);
      setCurrentStage(null);
      setWorkflowStatus('idle');
      setPercentage(0);
      return;
    }
    setLoading(true);
    try {
      const data = await apiRequest<PipelineStatusResponse>(`/projects/${projectId}/pipeline-status`);
      setStages(data.stages || []);
      setCurrentStage(data.current_stage);
      setWorkflowStatus(data.workflow_status);
      setPercentage(data.percentage);
    } catch {
      setStages([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => subscribeToSelectedProject(setProjectId), []);
  useEffect(() => {
    refreshStatuses();
  }, [refreshStatuses]);
  useEffect(() => {
    const interval = setInterval(refreshStatuses, 4000);
    return () => clearInterval(interval);
  }, [refreshStatuses]);

  const statuses = useMemo(() => {
    const byStageKey = Object.fromEntries(stages.map((s) => [s.key, s.status]));
    const out: Record<string, AgentStatus> = {};
    for (const [agentKey, stageKey] of Object.entries(AGENT_KEY_TO_STAGE_KEY)) {
      out[agentKey] = mapStageStatus(byStageKey[stageKey]);
    }
    return out;
  }, [stages]);

  const getAgentStatus = useCallback((agentKey: string) => statuses[agentKey] || 'idle', [statuses]);

  const value: AgentStatusContextValue = {
    statuses, getAgentStatus, refreshStatuses, loading, currentStage, workflowStatus, percentage, stages,
  };

  return <AgentStatusContext.Provider value={value}>{children}</AgentStatusContext.Provider>;
}

export function useAgentStatus(): AgentStatusContextValue {
  const ctx = useContext(AgentStatusContext);
  if (!ctx) throw new Error('useAgentStatus must be used within an AgentStatusProvider');
  return ctx;
}
