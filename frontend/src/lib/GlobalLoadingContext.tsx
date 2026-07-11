import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiRequest } from './api';
import { getSelectedProjectId, subscribeToSelectedProject } from './projectContext';

interface GlobalLoadingContextValue {
  isGlobalLoading: boolean;
  globalLoadingMessage: string;
  progressPercent: number;
  activeStage: string | null;
  workflowStatus: string;
  triggerStartPipeline: () => Promise<void>;
  /** No POST /build/stop endpoint exists on the backend — always false, and
   *  callers should hide/disable any "halt build" affordance rather than
   *  fake a stop that doesn't happen server-side. */
  canStopPipeline: boolean;
}

const GlobalLoadingContext = createContext<GlobalLoadingContextValue | undefined>(undefined);

// Ported from Bhumika's GlobalLoadingContext. Rewired: /build/start now sends
// the real {project_id: number} body my backend's BuildStartRequest expects
// (was {projectId: string}); the fake EventSource('/api/projects/.../pipeline/stream')
// SSE subscription (no such endpoint exists on either backend) is replaced
// with polling GET /projects/{id}/pipeline-status — the same endpoint
// AgentStatusService already polls; and /build/stop (nonexistent) is dropped
// entirely rather than faking success.
export function GlobalLoadingProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectId] = useState<string | null>(() => getSelectedProjectId());
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<string>('idle');
  const [progressPercent, setProgressPercent] = useState<number>(0);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setActiveStage(null);
      setWorkflowStatus('idle');
      setProgressPercent(0);
      return;
    }
    try {
      const data = await apiRequest<{ current_stage: string | null; workflow_status: string; percentage: number }>(
        `/projects/${projectId}/pipeline-status`
      );
      setActiveStage(data.current_stage);
      setWorkflowStatus(data.workflow_status);
      setProgressPercent(data.percentage);
    } catch {
      // keep last-known state on transient errors
    }
  }, [projectId]);

  useEffect(() => subscribeToSelectedProject(setProjectId), []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  const triggerStartPipeline = useCallback(async () => {
    if (!projectId) return;
    await apiRequest('/build/start', { method: 'POST', body: { project_id: Number(projectId) } });
    await refresh();
  }, [projectId, refresh]);

  const isGlobalLoading = workflowStatus === 'running';
  const globalLoadingMessage = activeStage ? `Running ${activeStage}...` : '';

  const value: GlobalLoadingContextValue = {
    isGlobalLoading,
    globalLoadingMessage,
    progressPercent,
    activeStage,
    workflowStatus,
    triggerStartPipeline,
    canStopPipeline: false,
  };

  return <GlobalLoadingContext.Provider value={value}>{children}</GlobalLoadingContext.Provider>;
}

export function useGlobalLoading(): GlobalLoadingContextValue {
  const ctx = useContext(GlobalLoadingContext);
  if (!ctx) throw new Error('useGlobalLoading must be used within a GlobalLoadingProvider');
  return ctx;
}
