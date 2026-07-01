import React from 'react';
import { Mic, Play, MessageSquare, Volume2 } from 'lucide-react';

interface NarrationPanelProps {
  slide: any;
  onNotesChange: (notes: string) => void;
  onGenerateVoice: () => void;
}

export function NarrationPanel({ slide, onNotesChange, onGenerateVoice }: NarrationPanelProps) {
  return (
    <div className="h-40 bg-dark-surface border-t border-dark-border p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs font-medium text-text-muted">
          <MessageSquare size={14} /> Speaker Notes & Narration
        </label>
        <button 
          onClick={onGenerateVoice}
          className="flex items-center gap-1.5 bg-dark-bg px-2 py-1 rounded text-xs hover:text-ey-yellow transition-colors"
        >
          <Volume2 size={12} /> Generate Voice
        </button>
      </div>
      <textarea 
        className="flex-1 w-full bg-dark-bg border border-dark-border rounded-md p-3 text-sm focus:ring-1 focus:ring-ey-yellow outline-none resize-none"
        placeholder="Enter speaker notes here..."
        value={slide?.speaker_notes || ''}
        onChange={(e) => onNotesChange(e.target.value)}
      />
    </div>
  );
}