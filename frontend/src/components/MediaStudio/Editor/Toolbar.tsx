import React from 'react';
import { Undo, Redo, Sparkles, Layout, Type, Image as ImageIcon, GitBranch } from 'lucide-react';

export function Toolbar({ onAction, canUndo, canRedo, onUndo, onRedo }: any) {
  const tools = [
    { name: 'Beautify', icon: Sparkles, action: 'beautify' },
    { name: 'Diagram', icon: GitBranch, action: 'generate_diagram' },
    { name: 'Image', icon: ImageIcon, action: 'generate_image' },
  ];

  return (
    <div className="h-12 bg-dark-surface border-b border-dark-border flex items-center px-4 gap-4">
      <div className="flex gap-2">
        <button onClick={onUndo} disabled={!canUndo}><Undo size={16}/></button>
        <button onClick={onRedo} disabled={!canRedo}><Redo size={16}/></button>
      </div>
      <div className="h-6 w-px bg-dark-border" />
      {tools.map(t => (
        <button key={t.name} onClick={() => onAction(t.action)} className="flex items-center gap-2 text-xs hover:text-ey-yellow">
          <t.icon size={16} /> {t.name}
        </button>
      ))}
    </div>
  );
}