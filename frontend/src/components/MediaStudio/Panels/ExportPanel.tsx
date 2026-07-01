import React from 'react';
import { Download, FileText, Video, Image as ImageIcon } from 'lucide-react';

export function ExportPanel({ onExport }: { onExport: (format: string) => void }) {
  const formats = [
    { label: 'PowerPoint (.pptx)', icon: FileText, id: 'pptx' },
    { label: 'PDF Document', icon: FileText, id: 'pdf' },
    { label: 'Video (MP4)', icon: Video, id: 'mp4' },
    { label: 'Slides Images', icon: ImageIcon, id: 'png' },
  ];

  return (
    <div className="bg-dark-surface p-4 rounded-lg border border-dark-border">
      <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
        <Download size={16} /> Export Presentation
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {formats.map((f) => (
          <button 
            key={f.id}
            onClick={() => onExport(f.id)}
            className="flex flex-col items-center gap-2 p-3 bg-dark-bg rounded border border-dark-border hover:border-ey-yellow transition-colors"
          >
            <f.icon size={20} className="text-text-muted" />
            <span className="text-[10px] text-center">{f.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}