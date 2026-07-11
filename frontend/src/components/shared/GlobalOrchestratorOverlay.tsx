import { Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { useGlobalLoading } from '../../lib/GlobalLoadingContext';

// Ported from Bhumika's GlobalOrchestratorOverlay, rewired to consume the
// fixed GlobalLoadingContext (real polling of GET /projects/{id}/pipeline-status,
// no fake SSE stream chunks). "Halt Build" is omitted — no POST /build/stop
// endpoint exists on the backend, so there's nothing real for it to do.
export function GlobalOrchestratorOverlay() {
  const { isGlobalLoading, globalLoadingMessage, progressPercent, activeStage } = useGlobalLoading();
  const [dismissed, setDismissed] = useState(false);

  if (!isGlobalLoading || dismissed) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40 w-72 bg-dark-card border border-ey-yellow/30 rounded-2xl shadow-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Loader2 size={14} className="text-ey-yellow animate-spin" />
          <span className="text-[11px] font-black uppercase tracking-wider text-text-primary">Pipeline Running</span>
        </div>
        <button onClick={() => setDismissed(true)} className="text-text-muted hover:text-white">
          <X size={14} />
        </button>
      </div>
      <p className="text-xs text-text-secondary">{globalLoadingMessage || (activeStage ? `Running ${activeStage}...` : 'Working...')}</p>
      <div className="h-1.5 w-full bg-dark-bg rounded-full overflow-hidden">
        <div className="h-full bg-ey-yellow transition-all duration-500" style={{ width: `${progressPercent}%` }} />
      </div>
      <p className="text-[9px] text-text-muted font-mono text-right">{progressPercent}%</p>
    </div>
  );
}
