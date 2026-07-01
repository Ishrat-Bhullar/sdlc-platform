/**
 * useProjectArtifacts.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared hook: fetch generated_artifacts for a project and expose typed helpers.
 * 
 * IMPORTANT: This hook expects a string projectId (UUID) from projectContext.
 * It handles both string and number internally for API compatibility.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiRequest } from './api';
import { getSelectedProjectId } from './projectContext';

export interface RawArtifact {
  id: number;
  project_id: string | number;
  artifact_type: string;
  content: string | Record<string, unknown>;
  created_at: string;
}

/**
 * Parses artifact content from string or object format.
 */
function parseContent(raw: string | Record<string, unknown>): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return { raw_text: raw };
    }
  }
  return raw as Record<string, unknown>;
}

/**
 * Shared hook: fetch generated_artifacts for a project and expose typed helpers.
 * 
 * @param projectId - String UUID from getSelectedProjectId() or getProjectIdFromRoute()
 */
export function useProjectArtifacts(projectId: string | null) {
  const [artifacts, setArtifacts] = useState<RawArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the projectId that initiated the current request to prevent stale responses
  const requestProjectIdRef = useRef<string | null>(null);

  // Normalize projectId for API calls (handle both string UUID and number)
  const apiProjectId = useMemo(() => {
    if (!projectId) return null;
    // API accepts string UUID or number - prefer what's stored
    return projectId;
  }, [projectId]);

  const load = useCallback(async () => {
    if (!apiProjectId) {
      setArtifacts([]);
      requestProjectIdRef.current = null;
      return;
    }
    // Track which project we're loading for - don't overwrite if it's changed
    requestProjectIdRef.current = apiProjectId;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<RawArtifact[]>(
        `/generated_artifacts?project_id=${apiProjectId}`
      );
      // Only update state if the projectId hasn't changed since the request started
      if (requestProjectIdRef.current === apiProjectId) {
        setArtifacts(data || []);
      }
    } catch (e) {
      // Only set error if the projectId hasn't changed since the request started
      if (requestProjectIdRef.current === apiProjectId) {
        setError(e instanceof Error ? e.message : 'Failed to load artifacts');
      }
    } finally {
      // Only clear loading if the projectId hasn't changed since the request started
      if (requestProjectIdRef.current === apiProjectId) {
        setLoading(false);
      }
    }
  }, [apiProjectId]);

  // Reset artifacts when projectId changes to prevent stale data display
  useEffect(() => {
    requestProjectIdRef.current = projectId;
    setArtifacts([]);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  function getArtifact(type: string): Record<string, unknown> | null {
    const match = artifacts.find((a) => a.artifact_type === type);
    return match ? parseContent(match.content) : null;
  }

  function getRaw(type: string): RawArtifact | null {
    return artifacts.find((a) => a.artifact_type === type) ?? null;
  }

  return { artifacts, loading, error, getArtifact, getRaw, reload: load, parseContent };
}

/**
 * Hook to get project artifacts using the currently selected project from context.
 * Convenience wrapper that combines getSelectedProjectId() + useProjectArtifacts().
 */
export function useSelectedProjectArtifacts() {
  const projectId = getSelectedProjectId();
  return useProjectArtifacts(projectId);
}

export { parseContent };

