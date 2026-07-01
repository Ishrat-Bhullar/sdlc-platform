import React from 'react';

export function TimelineEditor({ slides }: any) {
  return (
    <div className="h-32 bg-dark-surface border-t border-dark-border p-4">
      <h3 className="text-xs font-bold text-text-muted mb-2">Timeline</h3>
      <div className="flex gap-1 overflow-x-auto">
        {slides.map((s: any) => (
          <div key={s.id} className="w-16 h-16 bg-dark-bg border border-dark-border rounded flex items-center justify-center text-[10px]">
            {s.duration}s
          </div>
        ))}
      </div>
    </div>
  );
}