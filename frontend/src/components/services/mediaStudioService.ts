import { apiRequest } from '../../lib/api';
import { MediaStudioState } from '../types/mediaStudio';

export const mediaStudioService = {
  async savePresentation(projectId: number, data: MediaStudioState) {
    return apiRequest(`/projects/${projectId}/presentation/save`, {
      method: 'POST',
      body: data
    });
  },

  async runAiAction(projectId: number, slideId: number, actionType: string, context: any) {
    return apiRequest('/media-studio/ai-action', {
      method: 'POST',
      body: { project_id: projectId, slide_id: slideId, action_type: actionType, context }
    });
  },

  async generateFinalAssets(projectId: number) {
    return apiRequest(`/projects/${projectId}/presentation/generate`, {
      method: 'POST'
    });
  }
};