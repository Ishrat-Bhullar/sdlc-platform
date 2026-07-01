import React from 'react';

interface SlideSidebarProps {
  slides: any[];
  activeId: number | null;
  onSelect: (id: number) => void;
}

export function SlideSidebar({ slides, activeId, onSelect }: SlideSidebarProps) {
  return (
    <div className="w-48 bg-dark-surface border-r border-dark-border flex flex-col p-2 gap-2">
      {slides.map((slide, idx) => (
        <div 
          key={slide.id}
          onClick={() => onSelect(slide.id)}
          className={`h-24 border-2 rounded ${activeId === slide.id ? 'border-ey-yellow' : 'border-dark-border'}`}
        >
          <div className="text-[10px] p-1 text-text-muted">{idx + 1}</div>
        </div>
      ))}
    </div>
  );
}