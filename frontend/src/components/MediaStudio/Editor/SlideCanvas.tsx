import React from 'react';

interface SlideCanvasProps {
  slide: any;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (slide: any) => void;
}

export function SlideCanvas({ slide, selectedId, onSelect, onChange }: SlideCanvasProps) {
  if (!slide) return <div className="flex-1 flex items-center justify-center text-text-muted">Select a slide to edit</div>;

  return (
    <div className="flex-1 p-8 overflow-auto relative cursor-crosshair">
      <div className="w-[960px] h-[540px] bg-white shadow-2xl mx-auto relative overflow-hidden transition-all">
        {slide.objects?.map((obj: any) => (
          <div
            key={obj.id}
            className={`absolute border ${selectedId === obj.id ? 'border-ey-yellow' : 'border-transparent'}`}
            style={{ left: obj.x, top: obj.y, width: obj.w, height: obj.h }}
            onClick={(e) => { e.stopPropagation(); onSelect(obj.id); }}
          >
            {obj.type === 'text' && <p className="text-black p-2">{obj.content}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}