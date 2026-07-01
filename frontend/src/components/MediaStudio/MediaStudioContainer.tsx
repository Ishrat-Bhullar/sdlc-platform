import React, { useState } from 'react';
import { StudioConfiguration } from './Configuration/StudioConfiguration';
import { PresentationEditor } from './Editor/PresentationEditor';
import { ProgressDialog } from './Panels/ProgressDialog';
import { ExportPanel } from './Panels/ExportPanel';
import { NarrationPanel } from './Panels/NarrationPanel';

/**
 * MediaStudioContainer.tsx
 * ──────────────────────────
 * Main wrapper for the Enterprise Media Studio.
 * Orchestrates the Configuration, Editor, and Side Panels.
 */

export function MediaStudioContainer({ projectId, initialData }: { projectId: number, initialData: any }) {
  const [config, setConfig] = useState({
    mode: 'Presentation + Video',
    theme: 'EY Theme',
    presentationMode: 'Executive Summary',
    avatar: { mode: 'preset', value: 'Professional Male' },
    scene: { mode: 'preset', value: 'Office' },
    voice: { language: 'en-US' }
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState({ step: 'Initializing', percent: 0 });

  const handleGenerate = () => {
    setIsGenerating(true);
    setProgress({ step: 'Generating Presentation Structure...', percent: 20 });
    // Trigger backend pipeline via mediaStudioService
  };

  return (
    <div className="flex h-screen w-full bg-dark-bg text-text-primary overflow-hidden">
      {/* Left Configuration Sidebar */}
      <div className="w-80 flex-shrink-0 border-r border-dark-border">
        <StudioConfiguration 
          onConfigChange={setConfig} 
          onGenerate={handleGenerate} 
          initialConfig={config}
        />
      </div>

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-hidden">
          <PresentationEditor 
            projectId={projectId} 
            initialData={initialData} 
          />
        </div>
        
        {/* Bottom Narration Panel */}
        <NarrationPanel 
          slide={initialData.slides[0]} // Simplification for container structure
          onNotesChange={(notes) => console.log(notes)}
          onGenerateVoice={() => {}}
        />
      </div>

      {/* Right Utility Sidebar */}
      <div className="w-72 flex-shrink-0 border-l border-dark-border bg-dark-surface p-4">
        <ExportPanel onExport={(format) => console.log('Exporting:', format)} />
      </div>

      {/* Global Progress Modal */}
      <ProgressDialog 
        visible={isGenerating} 
        progress={progress} 
      />
    </div>
  );
}