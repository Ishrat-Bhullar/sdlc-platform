import { useState, useCallback } from 'react';
import { mediaStudioService } from '../services/mediaStudioService';
import { usePipelineUpdates } from '../../hooks/usePipelineUpdates';

interface PipelineEvent {
  type: string;
  [key: string]: unknown;
}

export function useMediaStudio(projectId: number, initialData: any) {
  const [presentation, setPresentation] = useState(initialData);
  const [activeSlideId, setActiveSlideId] = useState(initialData.slides[0]?.id);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([initialData]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const updatePresentation = useCallback((newData: any) => {
    setPresentation(newData);
    const newHistory = history.slice(0, historyIndex + 1);
    setHistory([...newHistory, newData]);
    setHistoryIndex(newHistory.length);
    mediaStudioService.savePresentation(projectId, newData);
  }, [history, historyIndex, projectId]);

  const undo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      setPresentation(history[historyIndex - 1]);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
      setPresentation(history[historyIndex + 1]);
    }
  };

const triggerAiAction = async (actionType: string, context: any) => {
    try {
      const result = await mediaStudioService.runAiAction(projectId, activeSlideId, actionType, context) as { updated_slide?: unknown };
      if (result.updated_slide) {
        // Update specific slide logic here
      }
    } catch (e) {
      console.error("AI Action Failed", e);
    }
  };

usePipelineUpdates(projectId, (event: PipelineEvent) => {
    if (event.type === 'slide_updated') {
      // Refresh logic
    }
  });

  return {
    presentation,
    activeSlideId,
    setActiveSlideId,
    selectedObjectId,
    setSelectedObjectId,
    updatePresentation,
    undo,
    redo,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    triggerAiAction
  };
}