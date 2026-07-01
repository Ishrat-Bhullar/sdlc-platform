import { apiRequest } from '../../lib/api';

export const diagramService = {
  async generateDiagram(type: string, prompt: string) {
    return apiRequest('/media-studio/diagram/generate', {
      method: 'POST',
      body: { type, prompt }
    });
  },

  getDiagramTypes() {
    return [
      'Flowchart', 'ER Diagram', 'Architecture Diagram', 
      'Sequence Diagram', 'Deployment Diagram', 'Mind Map'
    ];
  }
};