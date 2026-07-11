import { Network } from 'lucide-react';
import type { UIUXScreen, UIUXUserFlow } from '../../types/unified';

interface UserFlowsProps {
  screens: UIUXScreen[];
  userFlows: UIUXUserFlow[];
  selectedIdx: number;
  onSelectScreen: (idx: number) => void;
}

// Ported from Bhumika's flow diagram. Retyped to real UIUXScreen/UIUXUserFlow
// — the connector list below is now derived from each userFlow's actual
// `screens` sequence instead of a hardcoded 3-transition array.
export function UserFlows({ screens, userFlows, selectedIdx, onSelectScreen }: UserFlowsProps) {
  return (
    <div className="bg-dark-card border border-dark-border rounded-2xl p-5 space-y-4 shadow-xl">
      <div className="flex items-center justify-between border-b border-dark-border pb-3">
        <div className="flex items-center gap-2">
          <Network className="h-4.5 w-4.5 text-ey-yellow" />
          <h3 className="text-xs font-black uppercase tracking-wider text-text-primary">Application Flow Mapping</h3>
        </div>
      </div>

      <div className="bg-dark-bg border border-dark-border rounded-2xl p-6 overflow-x-auto min-h-[220px] flex flex-col justify-center relative">
        <div className="flex justify-between items-center gap-6 min-w-[600px] relative z-10 px-4 flex-wrap">
          {screens.map((screen, idx) => {
            const isSelected = selectedIdx === idx;
            return (
              <div
                key={idx}
                onClick={() => onSelectScreen(idx)}
                className={`p-3.5 rounded-xl border w-[170px] text-center space-y-2.5 cursor-pointer transition-all ${
                  isSelected ? 'bg-ey-yellow/5 border-ey-yellow shadow-md shadow-ey-yellow/5' : 'bg-dark-cardHover border-dark-border hover:border-dark-border-light'
                }`}
              >
                <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold mx-auto border ${isSelected ? 'bg-ey-yellow text-black border-ey-yellow' : 'bg-dark-bg text-text-muted border-dark-border'}`}>
                  {String(idx + 1).padStart(2, '0')}
                </div>
                <div className="space-y-0.5">
                  <span className="text-[7px] font-mono font-bold text-ey-yellow uppercase tracking-widest block">{screen.type || 'page'}</span>
                  <h5 className="text-[10px] font-bold text-text-primary truncate">{screen.name}</h5>
                </div>
                <p className="text-[8px] text-text-muted line-clamp-2">{screen.purpose}</p>
              </div>
            );
          })}
          {screens.length === 0 && <p className="text-[10px] text-text-muted italic">No screens generated yet.</p>}
        </div>

        {userFlows.length > 0 && (
          <div className="mt-8 grid grid-cols-1 gap-3 border-t border-dark-border/60 pt-4 text-[10px]">
            {userFlows.map((flow, i) => (
              <div key={i} className="bg-dark-cardHover/60 border border-dark-border p-2.5 rounded-xl">
                <span className="font-bold text-text-primary block">{flow.name}</span>
                <div className="flex flex-wrap items-center gap-1 mt-1.5">
                  {flow.screens.map((s, si) => (
                    <span key={si} className="flex items-center gap-1">
                      <span className="text-[9px] text-ey-yellow font-mono px-1.5 py-0.5 rounded bg-ey-yellow/10">{s}</span>
                      {si < flow.screens.length - 1 && <span className="text-text-muted">→</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
