import React from 'react';

export function PropertiesPanel({ selectedObject, onUpdate }: any) {
  if (!selectedObject) return <div className="w-64 bg-dark-surface p-4 text-text-muted text-xs">Select an element</div>;

  return (
    <div className="w-64 bg-dark-surface border-l border-dark-border p-4">
      <h3 className="text-sm font-bold mb-4">Properties</h3>
      <div className="space-y-4">
        <div>
          <label className="text-[10px] text-text-muted block">Position X / Y</label>
          <div className="flex gap-2">
            <input className="w-full bg-dark-bg p-1 text-xs" value={selectedObject.x} readOnly />
            <input className="w-full bg-dark-bg p-1 text-xs" value={selectedObject.y} readOnly />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-text-muted block">Content</label>
          <input className="w-full bg-dark-bg p-1 text-xs" value={selectedObject.content || ''} />
        </div>
      </div>
    </div>
  );
}