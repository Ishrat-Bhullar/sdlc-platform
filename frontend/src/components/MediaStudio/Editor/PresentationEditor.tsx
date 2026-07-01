import React, { useState } from 'react';
import { SlideSidebar } from './SlideSidebar';
import { SlideCanvas } from './SlideCanvas';
import { Toolbar } from './Toolbar';
import { PropertiesPanel } from './PropertiesPanel';
import { TimelineEditor } from './TimelineEditor';
import { useMediaStudio } from '../../hooks/useMediaStudio';

export function PresentationEditor({ projectId, initialData }: { projectId: number, initialData: any }) {
  const { 
    presentation, activeSlideId, setActiveSlideId, selectedObjectId, setSelectedObjectId,
    updatePresentation, undo, redo, canUndo, canRedo, triggerAiAction 
  } = useMediaStudio(projectId, initialData);

  return (
    <div className="flex flex-col h-full bg-dark-bg text-text-primary overflow-hidden">
      <Toolbar 
        onAction={triggerAiAction} 
        canUndo={canUndo} 
        canRedo={canRedo} 
        onUndo={undo} 
        onRedo={redo} 
      />
      <div className="flex flex-1 overflow-hidden">
        <SlideSidebar 
          slides={presentation.slides} 
          activeId={activeSlideId} 
          onSelect={setActiveSlideId} 
        />
        <div className="flex-1 flex flex-col bg-[#121212]">
          <SlideCanvas 
            slide={presentation.slides.find((s: any) => s.id === activeSlideId)}
            selectedId={selectedObjectId}
            onSelect={setSelectedObjectId}
            onChange={(updated) => updatePresentation({ ...presentation, slides: presentation.slides.map((s: any) => s.id === updated.id ? updated : s) })}
          />
          <TimelineEditor slides={presentation.slides} />
        </div>
        <PropertiesPanel 
          selectedObject={presentation.slides.find((s: any) => s.id === activeSlideId)?.objects?.find((o: any) => o.id === selectedObjectId)}
onUpdate={(obj: unknown) => { /* Logic to update object properties in active slide */ }}
        />
      </div>
    </div>
  );
}