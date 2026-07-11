import { useEffect, useState } from 'react';
import { Save, Check } from 'lucide-react';
import { getSelectedProjectId } from '../../lib/projectContext';

const DRAFT_CHANGED_EVENT = 'sdlc-studio-draft-changed';

export function studioDraftKey(projectId: string | null): string {
  return `sdlc_uiux_studio_draft_${projectId || 'global'}`;
}

/** Marks the UI/UX Studio canvas as having unsaved local edits (component
 *  insert/rename/reorder before the next Generate/Refine call persists a
 *  new backend artifact). Purely client-side scratch state — the backend
 *  has no draft-artifact concept, so this never claims to be synced. */
export function markStudioDraftDirty(projectId: string | null) {
  try {
    localStorage.setItem(studioDraftKey(projectId), '1');
  } catch {
    // ignore storage failures
  }
  window.dispatchEvent(new Event(DRAFT_CHANGED_EVENT));
}

export function clearStudioDraft(projectId: string | null) {
  try {
    localStorage.removeItem(studioDraftKey(projectId));
  } catch {
    // ignore storage failures
  }
  window.dispatchEvent(new Event(DRAFT_CHANGED_EVENT));
}

// Ported from Bhumika's AutoSaveIndicator, scoped down: her version claimed
// to auto-save 12 different workspaces' drafts, but this backend has no
// draft-artifact persistence at all (artifacts are LLM-generated, not
// user-edited documents). This becomes a lightweight, honest "unsaved
// canvas edits" indicator for the new UI/UX Studio tab specifically —
// client-side scratch state only, not a claim of backend sync.
export function AutoSaveIndicator() {
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const projectId = getSelectedProjectId();
    const check = () => {
      try {
        setDirty(localStorage.getItem(studioDraftKey(projectId)) === '1');
      } catch {
        setDirty(false);
      }
    };
    check();
    window.addEventListener(DRAFT_CHANGED_EVENT, check);
    window.addEventListener('storage', check);
    return () => {
      window.removeEventListener(DRAFT_CHANGED_EVENT, check);
      window.removeEventListener('storage', check);
    };
  }, []);

  if (!dirty) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-text-muted" title="No unsaved Studio canvas edits">
        <Check size={11} className="text-status-success" />
        <span className="hidden lg:inline">Saved</span>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-[10px] text-ey-yellow" title="Unsaved UI/UX Studio canvas edits — Generate or Refine to persist">
      <Save size={11} className="animate-pulse" />
      <span className="hidden lg:inline">Unsaved draft</span>
    </span>
  );
}
