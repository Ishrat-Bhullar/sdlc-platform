import React from 'react';

interface ProgressDialogProps {
  progress: { step: string; percent: number };
  visible: boolean;
}

export function ProgressDialog({ progress, visible }: ProgressDialogProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-dark-bg/80 flex items-center justify-center z-50">
      <div className="bg-dark-surface border border-dark-border p-6 rounded-lg w-96 shadow-2xl">
        <h2 className="text-lg font-bold mb-4">Generating Media...</h2>
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span>{progress.step}</span>
            <span>{Math.round(progress.percent)}%</span>
          </div>
          <div className="w-full bg-dark-bg h-2 rounded-full overflow-hidden">
            <div 
              className="bg-ey-yellow h-full transition-all duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}