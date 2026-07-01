export const SELECTED_PROJECT_ID_KEY = 'selectedProjectId';
const SELECTED_PROJECT_CHANGED_EVENT = 'selected-project-changed';

export function parseProjectId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Gets the currently selected project ID from localStorage.
 * Returns string UUID or null if not set.
 */
export function getSelectedProjectId(): string | null {
  try {
    return parseProjectId(localStorage.getItem(SELECTED_PROJECT_ID_KEY));
  } catch {
    return null;
  }
}

/**
 * Gets the selected project ID from a route parameter, falling back to localStorage.
 * Useful for pages that accept projectId as a route param.
 */
export function getProjectIdFromRoute(routeParam: string | undefined): string | null {
  if (routeParam) return parseProjectId(routeParam);
  return getSelectedProjectId();
}

export function setSelectedProjectId(projectId: string | null | undefined): string | null {
  const parsed = parseProjectId(projectId);
  try {
    if (parsed === null) localStorage.removeItem(SELECTED_PROJECT_ID_KEY);
    else localStorage.setItem(SELECTED_PROJECT_ID_KEY, parsed);
  } catch {
    // ignore storage failures
  }

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(SELECTED_PROJECT_CHANGED_EVENT, { detail: { projectId: parsed } }));
    } catch {
      // ignore event dispatch failures
    }
  }

  return parsed;
}

export function subscribeToSelectedProject(listener: (projectId: string | null) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (event: Event) => {
    const custom = event as CustomEvent<{ projectId?: string | null }>;
    listener(parseProjectId(custom?.detail?.projectId));
  };

  window.addEventListener(SELECTED_PROJECT_CHANGED_EVENT, handler as EventListener);
  window.addEventListener('storage', () => listener(getSelectedProjectId()));
  return () => {
    window.removeEventListener(SELECTED_PROJECT_CHANGED_EVENT, handler as EventListener);
  };
}
