export interface PresentationSlide {
  id: number;
  title: string;
  subtitle: string;
  objects: SlideObject[];
  speaker_notes: string;
  duration: number;
}

export interface SlideObject {
  id: string;
  type: 'text' | 'image' | 'diagram';
  x: number;
  y: number;
  w: number;
  h: number;
  content: string;
}

export interface MediaStudioState {
  slides: PresentationSlide[];
  theme: string;
  mode: string;
  avatar: { mode: 'preset' | 'custom'; value: string };
  scene: { mode: 'preset' | 'custom'; value: string };
}

export type AiActionType = 
  | 'beautify' 
  | 'rewrite' 
  | 'generate_diagram' 
  | 'generate_image' 
  | 'translate';