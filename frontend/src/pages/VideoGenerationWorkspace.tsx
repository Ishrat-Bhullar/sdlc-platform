import { useState, useEffect, useRef, useCallback, useReducer } from 'react';
import { fastApiRequest, FASTAPI_BASE_URL } from '../lib/api';
import { useProjectArtifacts } from '../lib/useProjectArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import { useToast } from '../components/ui/Toast';
import {
  Video, Play, Pause, Download, Mic, Clock, CheckCircle2, AlertTriangle,
  Loader2, Volume2, Monitor, Palette, ChevronLeft, ChevronRight, Plus,
  Trash2, Copy, Type, Quote, BarChart3, Columns, Presentation,
  Sparkles, RefreshCw, Activity, User, X,
  Undo2, Redo2, GitBranch, FileText, Film,
  Layout, AlignLeft, Maximize2, MessageSquare, Send,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type SlideLayout = 'title' | 'content' | 'two_column' | 'quote' | 'metric' | 'closing';
type ThemeId = 'ey_dark' | 'ey_light' | 'mckinsey' | 'minimal';
type GenMode = 'presentation_only' | 'video_only' | 'presentation_video';
type VoiceId = 'samantha' | 'alex' | 'victoria' | 'daniel' | 'karen' | 'moira' | 'tom';
type VideoMode = 'slides' | 'avatar' | 'animated' | 'whiteboard';
type AiAction = 'beautify' | 'executive_style' | 'technical_style' | 'investor_pitch' |
  'academic_style' | 'rewrite' | 'shorten' | 'expand' | 'storytelling' | 'regenerate';

interface Slide {
  id: string;
  title: string;
  subtitle: string;
  content: string;
  speaker_notes: string;
  layout: SlideLayout;
  duration: number;
}

interface StoryboardFrame {
  slide_idx: number;
  title: string;
  thumb_b64: string;
  audio_duration: number;
  status: 'pending' | 'rendering' | 'rendered';
}

interface RenderJob {
  job_id: string;
  project_id: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  percent: number;
  stage: string;
  message: string;
  logs: string[];
  storyboard: StoryboardFrame[];
  video_artifact_id: number | null;
  avatar_artifact_id: number | null;
  duration_seconds: number;
  eta_seconds: number | null;
  fallback_used: boolean;
  error: string | null;
}

// ─── History reducer ──────────────────────────────────────────────────────────

interface HistoryState { past: Slide[][]; present: Slide[]; future: Slide[][]; }
type HistoryAction = { type: 'SET'; slides: Slide[] } | { type: 'UNDO' } | { type: 'REDO' };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'SET':
      return { past: [...state.past.slice(-30), state.present], present: action.slides, future: [] };
    case 'UNDO':
      if (!state.past.length) return state;
      return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] };
    case 'REDO':
      if (!state.future.length) return state;
      return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) };
    default: return state;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

// EY official brand: #2E2E38 charcoal, #FFE600 yellow, #FFFFFF white
const THEMES: Record<ThemeId, { label: string; bg: string; accent: string; title: string; body: string; muted: string; bar: string; header: string; footer: string; stripe: string; headerText: string }> = {
  ey_dark:   { label: 'EY Dark',       bg: '#2E2E38', accent: '#FFE600', title: '#FFFFFF', body: '#D8D8E0', muted: '#9090A0', bar: '#FFE600', header: '#1A1A24', footer: '#1A1A24', stripe: '#3A3A48', headerText: '#FFFFFF' },
  ey_light:  { label: 'EY Light',      bg: '#FFFFFF', accent: '#FFE600', title: '#2E2E38', body: '#4A4A58', muted: '#888898', bar: '#FFE600', header: '#2E2E38', footer: '#F2F2F5', stripe: '#F8F8FA', headerText: '#FFFFFF' },
  mckinsey:  { label: 'McKinsey Blue', bg: '#FFFFFF', accent: '#003865', title: '#003865', body: '#232332', muted: '#7878A0', bar: '#003865', header: '#003865', footer: '#E8EEF5', stripe: '#F4F7FA', headerText: '#FFFFFF' },
  minimal:   { label: 'Minimal',       bg: '#111118', accent: '#6366F1', title: '#FFFFFF', body: '#C0C0D8', muted: '#606080', bar: '#6366F1', header: '#0A0A12', footer: '#1C1C2D', stripe: '#1A1A28', headerText: '#FFFFFF' },
};

const LAYOUTS: Array<{ id: SlideLayout; label: string; icon: any }> = [
  { id: 'title',      label: 'Title',    icon: Presentation },
  { id: 'content',    label: 'Content',  icon: AlignLeft },
  { id: 'two_column', label: '2-Column', icon: Columns },
  { id: 'quote',      label: 'Quote',    icon: Quote },
  { id: 'metric',     label: 'Metric',   icon: BarChart3 },
  { id: 'closing',    label: 'Closing',  icon: CheckCircle2 },
];

const VOICES: Array<{ id: VoiceId; label: string; gender: 'M' | 'F'; accent: string }> = [
  { id: 'samantha', label: 'Samantha', gender: 'F', accent: 'American' },
  { id: 'alex',     label: 'Alex',     gender: 'M', accent: 'American' },
  { id: 'victoria', label: 'Victoria', gender: 'F', accent: 'Warm' },
  { id: 'daniel',   label: 'Daniel',   gender: 'M', accent: 'British' },
  { id: 'karen',    label: 'Karen',    gender: 'F', accent: 'Australian' },
  { id: 'moira',    label: 'Moira',    gender: 'F', accent: 'Irish' },
  { id: 'tom',      label: 'Tom',      gender: 'M', accent: 'Deep' },
];

const AVATARS = [
  { id: 'professional_male',   label: 'Professional Male',   emoji: '👨‍💼' },
  { id: 'professional_female', label: 'Professional Female', emoji: '👩‍💼' },
  { id: 'ceo',                 label: 'CEO',                 emoji: '👔' },
  { id: 'engineer',            label: 'Engineer',            emoji: '👨‍💻' },
  { id: 'doctor',              label: 'Doctor',              emoji: '👨‍⚕️' },
  { id: 'teacher',             label: 'Teacher',             emoji: '👨‍🏫' },
  { id: 'scientist',           label: 'Scientist',           emoji: '👨‍🔬' },
  { id: 'lawyer',              label: 'Lawyer',              emoji: '⚖️' },
  { id: 'student',             label: 'Student',             emoji: '👨‍🎓' },
  { id: 'police',              label: 'Police Officer',      emoji: '👮' },
  { id: 'govt_officer',        label: 'Govt. Officer',       emoji: '🏛️' },
  { id: 'news_anchor',         label: 'News Anchor',         emoji: '📺' },
  { id: 'minister',            label: 'Minister',            emoji: '🎤' },
  { id: 'chief_minister',      label: 'Chief Minister',      emoji: '🏅' },
  { id: 'prime_minister',      label: 'Prime Minister',      emoji: '🏆' },
  { id: 'farmer',              label: 'Farmer',              emoji: '👨‍🌾' },
  { id: 'village_woman',       label: 'Village Woman',       emoji: '👩‍🌾' },
  { id: 'factory_worker',      label: 'Factory Worker',      emoji: '👷' },
  { id: 'poor_family',         label: 'Poor Family',         emoji: '👨‍👩‍👧' },
  { id: 'child',               label: 'Child',               emoji: '👦' },
  { id: 'cartoon',             label: 'Cartoon',             emoji: '🎭' },
  { id: '3d_avatar',           label: '3D Avatar',           emoji: '🤖' },
];

const AI_ACTIONS: Array<{ id: AiAction; label: string; icon: string; desc: string }> = [
  { id: 'beautify',        label: 'Beautify',        icon: '✨', desc: 'Visual polish & hierarchy' },
  { id: 'executive_style', label: 'Executive',       icon: '👔', desc: 'C-suite language' },
  { id: 'technical_style', label: 'Technical',       icon: '⚙️', desc: 'Engineering depth' },
  { id: 'investor_pitch',  label: 'Investor Pitch',  icon: '📈', desc: 'ROI & opportunity' },
  { id: 'academic_style',  label: 'Academic',        icon: '🎓', desc: 'Formal evidence-based' },
  { id: 'rewrite',         label: 'Rewrite',         icon: '✍️', desc: 'Clarity & flow' },
  { id: 'shorten',         label: 'Shorten',         icon: '✂️', desc: 'Concise bullets' },
  { id: 'expand',          label: 'Expand',          icon: '↕️', desc: 'Add depth & detail' },
  { id: 'storytelling',    label: 'Storytelling',    icon: '📖', desc: 'Narrative arc' },
  { id: 'regenerate',      label: 'Regenerate',      icon: '🔄', desc: 'Fresh perspective' },
];

const DIAGRAM_TYPES = [
  { id: 'architecture', label: 'Architecture', icon: '🏗️' },
  { id: 'flowchart',    label: 'Flowchart',    icon: '🔄' },
  { id: 'er',           label: 'ER Diagram',   icon: '🗄️' },
  { id: 'sequence',     label: 'Sequence',     icon: '📋' },
  { id: 'class',        label: 'Class',        icon: '📐' },
  { id: 'deployment',   label: 'Deployment',   icon: '🚀' },
  { id: 'dataflow',     label: 'Data Flow',    icon: '📊' },
];

const PROGRESS_STAGES = [
  { label: 'Init', pct: 5 },
  { label: 'Slides', pct: 30 },
  { label: 'Script', pct: 45 },
  { label: 'Voice', pct: 65 },
  { label: 'Compose', pct: 80 },
  { label: 'Avatar', pct: 92 },
  { label: 'Saving', pct: 97 },
  { label: 'Done', pct: 100 },
];

const NATURAL_W = 1280;
const NATURAL_H = 720;

// ─── Editable text ────────────────────────────────────────────────────────────

function Editable({ value, onChange, style, placeholder, editing, multiline = false }: {
  value: string; onChange: (v: string) => void; style?: React.CSSProperties;
  placeholder?: string; editing: boolean; multiline?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current && ref.current.innerText !== value) ref.current.innerText = value || ''; }, [value]);
  if (!editing) return (
    <div style={{ ...style, whiteSpace: multiline ? 'pre-line' : 'nowrap', overflow: 'hidden' }}>
      {value || <span style={{ opacity: 0.3 }}>{placeholder}</span>}
    </div>
  );
  return (
    <div ref={ref} contentEditable suppressContentEditableWarning
      onInput={() => onChange(ref.current?.innerText || '')}
      style={{ ...style, outline: 'none', cursor: 'text', minHeight: 40, whiteSpace: multiline ? 'pre-line' : 'nowrap' }} />
  );
}

// ─── Slide Canvas ─────────────────────────────────────────────────────────────

function SlideCanvas({ slide, themeId, slideNum, total, editing, onUpdate }: {
  slide: Slide; themeId: ThemeId; slideNum: number; total: number;
  editing: boolean; onUpdate: (field: keyof Slide, value: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const theme = THEMES[themeId];

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setScale(el.getBoundingClientRect().width / NATURAL_W));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const layout = slide.layout || 'content';
  const isTitle = layout === 'title' || slideNum === 1;
  // EY template: white body, charcoal header bar, yellow left accent stripe
  const LOGO_Y = '#FFE600';
  const CHAR = theme.header;          // charcoal bar (#2E2E38 or equiv)
  const ACCENT = theme.accent;        // #FFE600
  const STRIPE_W = 12;                // yellow left stripe width
  const HDR_H = 90;                   // header bar height
  const FTR_H = 52;                   // footer height
  const GUTTER = 72;

  return (
    <div ref={containerRef} className="w-full" style={{ height: `${NATURAL_H * scale}px`, position: 'relative' }}>
      <div style={{ width: NATURAL_W, height: NATURAL_H, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', backgroundColor: theme.bg, fontFamily: '"EY Interstate", "Calibri", "Arial", sans-serif', overflow: 'hidden', boxShadow: editing ? `0 0 0 3px ${ACCENT}` : '0 4px 32px rgba(0,0,0,0.35)' }}>

        {/* Yellow left accent stripe */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: STRIPE_W, bottom: 0, backgroundColor: ACCENT }} />

        {/* Header bar */}
        <div style={{ position: 'absolute', top: 0, left: STRIPE_W, right: 0, height: HDR_H, backgroundColor: CHAR, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: GUTTER, paddingRight: 48 }}>
          {isTitle ? (
            <span style={{ color: ACCENT, fontSize: 32, fontWeight: 800, letterSpacing: 2 }}>EY</span>
          ) : (
            <Editable value={slide.title} onChange={v => onUpdate('title', v)} editing={editing}
              style={{ fontSize: 38, fontWeight: 700, color: theme.headerText, lineHeight: 1.1 }} placeholder="Slide Title" />
          )}
          <span style={{ color: ACCENT, fontSize: 18, fontWeight: 700, flexShrink: 0, marginLeft: 24 }}>{slideNum < 10 ? `0${slideNum}` : slideNum}</span>
        </div>

        {/* Footer bar */}
        <div style={{ position: 'absolute', bottom: 0, left: STRIPE_W, right: 0, height: FTR_H, backgroundColor: CHAR, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: GUTTER, paddingRight: 48 }}>
          <span style={{ color: theme.muted, fontSize: 18 }}>EY Autonomous SDLC Studio</span>
          <span style={{ color: theme.muted, fontSize: 18 }}>{slideNum} / {total}</span>
        </div>

        {/* Main content area */}
        {isTitle ? (
          /* Cover slide — full-bleed charcoal with yellow title */
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: CHAR, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingLeft: STRIPE_W + GUTTER, paddingRight: GUTTER * 2 }}>
            <div style={{ width: 80, height: 6, backgroundColor: ACCENT, marginBottom: 48 }} />
            <Editable value={slide.title} onChange={v => onUpdate('title', v)} editing={editing}
              style={{ fontSize: 88, fontWeight: 800, color: '#FFFFFF', lineHeight: 1.05, marginBottom: 32 }} placeholder="Presentation Title" />
            <Editable value={slide.subtitle || slide.content} onChange={v => onUpdate('subtitle', v)} editing={editing}
              style={{ fontSize: 36, color: '#B8B8C8', lineHeight: 1.55, maxWidth: 900 }} placeholder="Subtitle or summary statement" />
            <div style={{ marginTop: 72, fontSize: 22, color: theme.muted }}>EY &nbsp;|&nbsp; Confidential</div>
          </div>
        ) : layout === 'quote' ? (
          <div style={{ position: 'absolute', top: HDR_H, left: STRIPE_W + GUTTER, right: GUTTER, bottom: FTR_H, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontSize: 140, lineHeight: 0.8, color: ACCENT, fontWeight: 900, marginBottom: 16 }}>"</div>
            <Editable value={slide.title} onChange={v => onUpdate('title', v)} editing={editing}
              style={{ fontSize: 54, fontStyle: 'italic', color: theme.title, lineHeight: 1.4, maxWidth: 1000 }} placeholder="Enter the quote" />
            <div style={{ width: 100, height: 4, backgroundColor: ACCENT, margin: '32px 0' }} />
            <Editable value={slide.subtitle} onChange={v => onUpdate('subtitle', v)} editing={editing}
              style={{ fontSize: 30, color: theme.muted }} placeholder="— Name, Title" />
          </div>
        ) : layout === 'metric' ? (
          <div style={{ position: 'absolute', top: HDR_H, left: STRIPE_W + GUTTER, right: GUTTER, bottom: FTR_H, display: 'flex', alignItems: 'center', gap: 80 }}>
            <div style={{ flex: '0 0 auto' }}>
              <Editable value={slide.subtitle || '0'} onChange={v => onUpdate('subtitle', v)} editing={editing}
                style={{ fontSize: 200, fontWeight: 900, color: ACCENT, lineHeight: 1 }} placeholder="99%" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ width: 60, height: 6, backgroundColor: ACCENT, marginBottom: 24 }} />
              <Editable value={slide.content} onChange={v => onUpdate('content', v)} editing={editing}
                style={{ fontSize: 36, color: theme.body, lineHeight: 1.7 }} placeholder="What this metric represents and why it matters" multiline />
            </div>
          </div>
        ) : layout === 'two_column' ? (
          <div style={{ position: 'absolute', top: HDR_H, left: STRIPE_W, right: 0, bottom: FTR_H }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100%' }}>
              <div style={{ padding: `40px ${GUTTER}px 40px ${GUTTER}px`, borderRight: `1px solid ${theme.muted}30` }}>
                <div style={{ width: 48, height: 4, backgroundColor: ACCENT, marginBottom: 20 }} />
                <Editable value={slide.content} onChange={v => onUpdate('content', v)} editing={editing}
                  style={{ fontSize: 30, color: theme.body, lineHeight: 1.75 }} placeholder="Left column..." multiline />
              </div>
              <div style={{ padding: `40px ${GUTTER}px` }}>
                <div style={{ width: 48, height: 4, backgroundColor: CHAR, marginBottom: 20 }} />
                <Editable value={slide.subtitle} onChange={v => onUpdate('subtitle', v)} editing={editing}
                  style={{ fontSize: 30, color: theme.body, lineHeight: 1.75 }} placeholder="Right column..." multiline />
              </div>
            </div>
          </div>
        ) : layout === 'closing' ? (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: CHAR, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ width: 80, height: 6, backgroundColor: ACCENT, marginBottom: 48 }} />
            <Editable value={slide.title} onChange={v => onUpdate('title', v)} editing={editing}
              style={{ fontSize: 96, fontWeight: 900, color: '#FFFFFF', textAlign: 'center', lineHeight: 1.1 }} placeholder="Thank You" />
            <Editable value={slide.content} onChange={v => onUpdate('content', v)} editing={editing}
              style={{ fontSize: 34, color: '#B8B8C8', textAlign: 'center', marginTop: 32, maxWidth: 800 }} placeholder="Closing statement or call to action" />
          </div>
        ) : (
          /* Standard content slide */
          <div style={{ position: 'absolute', top: HDR_H, left: STRIPE_W + GUTTER, right: GUTTER, bottom: FTR_H, paddingTop: 36, paddingBottom: 20 }}>
            <div style={{ width: 48, height: 4, backgroundColor: ACCENT, marginBottom: 28 }} />
            <Editable value={slide.content} onChange={v => onUpdate('content', v)} editing={editing}
              style={{ fontSize: 32, color: theme.body, lineHeight: 1.85, whiteSpace: 'pre-line' }}
              placeholder={'• Key point 1\n• Key point 2\n• Key point 3'} multiline />
            {slide.subtitle && (
              <div style={{ marginTop: 28, paddingTop: 24, borderTop: `1px solid ${theme.muted}30` }}>
                <Editable value={slide.subtitle} onChange={v => onUpdate('subtitle', v)} editing={editing}
                  style={{ fontSize: 26, color: theme.muted, lineHeight: 1.5 }} placeholder="Supporting detail" />
              </div>
            )}
          </div>
        )}

        {/* Speaker notes panel — right sidebar for non-cover layouts */}
        {!isTitle && layout !== 'closing' && (
          <div style={{ position: 'absolute', top: HDR_H, right: 0, width: 300, bottom: FTR_H, backgroundColor: theme.stripe, borderLeft: `3px solid ${ACCENT}30`, padding: '24px 28px' }}>
            <div style={{ fontSize: 15, color: ACCENT, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 }}>Notes</div>
            <Editable value={slide.speaker_notes} onChange={v => onUpdate('speaker_notes', v)} editing={editing}
              style={{ fontSize: 22, color: theme.muted, lineHeight: 1.6 }} placeholder="Speaker notes..." multiline />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Slide thumbnail ──────────────────────────────────────────────────────────

function SlideThumbnail({ slide, themeId, slideNum, total, active, onClick }: {
  slide: Slide; themeId: ThemeId; slideNum: number; total: number; active: boolean; onClick: () => void;
}) {
  const theme = THEMES[themeId];
  const isTitle = slide.layout === 'title' || slideNum === 1;
  const isClosing = slide.layout === 'closing';
  const dark = isTitle || isClosing;
  return (
    <button onClick={onClick} className="w-full" style={{ outline: active ? `3px solid ${theme.accent}` : '2px solid transparent', borderRadius: 5, overflow: 'hidden', transition: 'outline 0.1s' }}>
      <div style={{ width: '100%', aspectRatio: '16/9', backgroundColor: dark ? theme.header : theme.bg, position: 'relative' }}>
        {/* Yellow left stripe */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: 4, bottom: 0, backgroundColor: theme.accent }} />
        {/* Header bar */}
        <div style={{ position: 'absolute', top: 0, left: 4, right: 0, height: dark ? 0 : 18, backgroundColor: theme.header }} />
        {/* Footer */}
        <div style={{ position: 'absolute', bottom: 0, left: 4, right: 0, height: 10, backgroundColor: theme.header }} />
        {/* Yellow accent line under header (content slides) */}
        {!dark && <div style={{ position: 'absolute', top: 22, left: 8, width: 14, height: 2, backgroundColor: theme.accent }} />}
        {/* Title text */}
        <div style={{ position: 'absolute', top: dark ? '30%' : 22, left: 8, right: 10, overflow: 'hidden' }}>
          <div style={{ fontWeight: 700, fontSize: 8, lineHeight: 1.2, color: dark ? '#FFFFFF' : theme.title, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{slide.title || `Slide ${slideNum}`}</div>
          {!dark && <div style={{ fontSize: 6.5, color: theme.body, marginTop: 3, overflow: 'hidden', height: 20, lineHeight: 1.4 }}>{slide.content?.slice(0, 55)}</div>}
        </div>
        <div style={{ position: 'absolute', bottom: 2, right: 5, fontSize: 6, color: theme.muted }}>{slideNum}</div>
      </div>
    </button>
  );
}

// ─── Video Player ─────────────────────────────────────────────────────────────

function VideoPlayer({ artifactId }: { artifactId: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const src = `${FASTAPI_BASE_URL}/video/render/play/${artifactId}`;

  return (
    <div className="rounded-xl overflow-hidden border border-dark-border bg-black">
      <video
        ref={videoRef}
        src={src}
        className="w-full"
        controls
        preload="metadata"
        crossOrigin="use-credentials"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
        style={{ maxHeight: '55vh', display: 'block' }}
      />
      <div className="flex items-center justify-between px-4 py-3 bg-dark-card border-t border-dark-border">
        <span className="text-xs text-text-muted">
          {duration > 0 ? `${Math.floor(currentTime)}s / ${Math.floor(duration)}s` : 'Presentation MP4 · Ready to play'}
        </span>
        <div className="flex items-center gap-2">
          <a href={`${FASTAPI_BASE_URL}/video/render/download/${artifactId}`}
            download={`presentation_${artifactId}.mp4`}
            className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-ey-yellow transition-colors btn-ghost px-3 py-1.5">
            <Download className="h-3.5 w-3.5" /> Download MP4
          </a>
          <a href={src} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-ey-yellow transition-colors btn-ghost px-3 py-1.5">
            <Maximize2 className="h-3.5 w-3.5" /> Open Full
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Progress overlay ─────────────────────────────────────────────────────────

function RenderProgress({ job, onClose }: { job: RenderJob; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-dark-border bg-dark-card shadow-2xl overflow-hidden">
        <div className="border-b border-dark-border px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-ey-yellow" />
            <h2 className="font-bold text-text-primary">Rendering Presentation</h2>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-6 space-y-5">
          {/* Stage pipeline */}
          <div className="flex gap-1">
            {PROGRESS_STAGES.map((s) => (
              <div key={s.label} className="flex-1 flex flex-col items-center gap-1">
                <div className={`h-1.5 w-full rounded-full transition-all ${job.percent >= s.pct ? 'bg-ey-yellow' : 'bg-dark-border'}`} />
                <span className={`text-[9px] font-medium ${job.percent >= s.pct ? 'text-ey-yellow' : 'text-text-muted'}`}>{s.label}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-text-primary font-medium">{job.stage}</span>
              <span className="text-ey-yellow font-bold">{job.percent}%</span>
            </div>
            <div className="h-3 rounded-full bg-dark-bg overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${job.percent}%`, background: 'linear-gradient(90deg, #FFE600, #FFB300)' }} />
            </div>
            {job.message && <p className="text-xs text-text-muted mt-1">{job.message}</p>}
          </div>
          {job.eta_seconds != null && job.status === 'running' && (
            <p className="text-xs text-text-muted flex items-center gap-1"><Clock className="h-3 w-3" />~{Math.ceil(job.eta_seconds)}s remaining</p>
          )}
          {job.logs.length > 0 && (
            <div className="rounded-lg bg-dark-bg border border-dark-border p-3 font-mono text-[10px] text-text-muted max-h-28 overflow-y-auto">
              {job.logs.slice(-8).map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Timeline editor ──────────────────────────────────────────────────────────

function TimelineEditor({ slides, onDurationChange }: { slides: Slide[]; onDurationChange: (idx: number, dur: number) => void }) {
  const total = slides.reduce((s, sl) => s + (sl.duration || 30), 0);
  return (
    <div className="border-t border-dark-border bg-dark-card px-4 py-3 flex-shrink-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" /> Timeline <span className="text-ey-yellow ml-1">{total}s</span>
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {slides.map((slide, i) => {
          const dur = slide.duration || 30;
          const pct = (dur / Math.max(total, 1)) * 100;
          return (
            <div key={slide.id} className="flex-shrink-0 flex flex-col gap-1" style={{ width: `${Math.max(pct, 5)}%`, minWidth: 52 }}>
              <div className="h-4 rounded bg-ey-yellow/20 border border-ey-yellow/30 flex items-center justify-center">
                <span className="text-[8px] text-ey-yellow font-medium">{i + 1}</span>
              </div>
              <input type="number" min={5} max={300} value={dur}
                onChange={e => onDurationChange(i, Number(e.target.value))}
                className="w-full text-center text-[9px] bg-dark-bg border border-dark-border rounded text-text-muted py-0.5" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Export panel ─────────────────────────────────────────────────────────────

function ExportPanel({ projectId, videoArtifactId, slides, onClose }: {
  projectId: number | null; videoArtifactId: number | null; slides: Slide[]; onClose: () => void;
}) {
  const downloadNotes = () => {
    const text = slides.map((s, i) => `Slide ${i+1}: ${s.title}\n${s.speaker_notes || '(no notes)'}`).join('\n\n---\n\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'speaker_notes.txt'; a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-dark-border bg-dark-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-dark-border px-6 py-4">
          <h2 className="font-bold text-text-primary flex items-center gap-2"><Download className="h-5 w-5 text-ey-yellow" /> Export</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-text-muted" /></button>
        </div>
        <div className="p-6 space-y-3">
          {[
            { label: 'Speaker Notes (.txt)',  icon: '🗒️', action: downloadNotes, desc: 'All slide notes' },
            ...(projectId ? [{ label: 'Narration Script (.txt)', icon: '📝', action: () => window.open(`${FASTAPI_BASE_URL}/video/render/export/script/${projectId}`, '_blank'), desc: 'Full speaker script' }] : []),
            ...(videoArtifactId ? [{ label: 'Video (.mp4)', icon: '🎬', action: () => window.open(`${FASTAPI_BASE_URL}/video/render/download/${videoArtifactId}`, '_blank'), desc: 'Full HD video' }] : []),
          ].map((item) => (
            <button key={item.label} onClick={item.action}
              className="w-full flex items-center gap-3 rounded-xl border border-dark-border bg-dark-bg p-4 hover:border-ey-yellow/40 transition-all text-left">
              <span className="text-2xl">{item.icon}</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">{item.label}</p>
                <p className="text-xs text-text-muted">{item.desc}</p>
              </div>
              <Download className="h-4 w-4 text-text-muted" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Diagram generator ────────────────────────────────────────────────────────

function DiagramGenerator({ projectId, onClose, onInsert }: {
  projectId: number | null; onClose: () => void; onInsert: (code: string) => void;
}) {
  const [type, setType] = useState('architecture');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const { addToast } = useToast();

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await fastApiRequest<any>('/media-studio/diagram/generate', {
        method: 'POST', body: { project_id: projectId, diagram_type: type },
      });
      const code = res?.diagram?.mermaid_code || res?.diagram?.diagram_code || res?.mermaid_code || JSON.stringify(res?.diagram || {}, null, 2);
      setResult(code);
    } catch { addToast('Diagram generation failed', 'error'); }
    finally { setGenerating(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-dark-border bg-dark-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-dark-border px-6 py-4">
          <h2 className="font-bold text-text-primary flex items-center gap-2"><GitBranch className="h-5 w-5 text-ey-yellow" /> AI Diagram Generator</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-text-muted" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {DIAGRAM_TYPES.map(d => (
              <button key={d.id} onClick={() => setType(d.id)}
                className={`rounded-xl border p-3 text-center transition-all ${type === d.id ? 'border-ey-yellow bg-ey-yellow/10' : 'border-dark-border hover:border-ey-yellow/30'}`}>
                <div className="text-2xl mb-1">{d.icon}</div>
                <p className={`text-xs ${type === d.id ? 'text-ey-yellow' : 'text-text-muted'}`}>{d.label}</p>
              </button>
            ))}
          </div>
          <button onClick={generate} disabled={generating} className="btn-primary w-full">
            {generating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</> : <><Sparkles className="mr-2 h-4 w-4" />Generate</>}
          </button>
          {result && (
            <div className="space-y-3">
              <div className="rounded-lg bg-dark-bg border border-dark-border p-4 font-mono text-xs text-text-muted max-h-48 overflow-y-auto whitespace-pre-wrap">{result}</div>
              <button onClick={() => { onInsert(result); onClose(); }} className="btn-secondary w-full">Insert into Slide</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function VideoGenerationWorkspace() {
  const projectId = getSelectedProjectId();
  const { addToast } = useToast();
  const { artifacts } = useProjectArtifacts(projectId);

  // Slide state with undo/redo
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: [], future: [] });
  const slides = history.present;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const setSlides = useCallback((fn: ((prev: Slide[]) => Slide[]) | Slide[]) => {
    const next = typeof fn === 'function' ? fn(history.present) : fn;
    dispatch({ type: 'SET', slides: next });
  }, [history.present]);

  // Editor state
  const [activeIdx, setActiveIdx] = useState(0);
  const [themeId, setThemeId] = useState<ThemeId>('ey_dark');
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'edit' | 'render' | 'video'>('edit');
  const [rightPanel, setRightPanel] = useState<'layout' | 'ai' | 'chat' | 'voice' | 'avatar'>('layout');

  // AI Presentation Chat
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([
    { role: 'assistant', text: 'Hi! Tell me how to change your presentation. Try:\n• "Change slide 3 to executive style"\n• "Add a slide after slide 6"\n• "Rewrite this slide technically"\n• "Shorten this content"\n• "Change theme to McKinsey"\n• "Regenerate slide 2"' },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  // Generation state
  const [genMode, setGenMode] = useState<GenMode>('presentation_video');
  const [videoMode, setVideoMode] = useState<VideoMode>('slides');
  const [voiceId, setVoiceId] = useState<VoiceId>('samantha');
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [selectedAvatar, setSelectedAvatar] = useState('professional_male');

  // Render job
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Previously generated video (persisted in DB)
  const [existingVideo, setExistingVideo] = useState<{ video_artifact_id: number; duration_seconds: number; mode?: string; slide_count?: number } | null>(null);

  // UI state
  const [loadingSlides, setLoadingSlides] = useState(true);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showDiagram, setShowDiagram] = useState(false);
  const [aiActionLoading, setAiActionLoading] = useState<AiAction | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfMode, setPdfMode] = useState(false); // when true, render from PDF instead of slides
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // ── Load previous video from DB ────────────────────────────────────────────
  useEffect(() => {
    if (!projectId) return;
    fastApiRequest<{ found: boolean; video_artifact_id?: number; duration_seconds?: number; mode?: string; slide_count?: number }>(
      `/video/render/latest/${projectId}`
    ).then(res => {
      if (res.found && res.video_artifact_id) {
        setExistingVideo({ video_artifact_id: res.video_artifact_id, duration_seconds: res.duration_seconds || 0, mode: res.mode, slide_count: res.slide_count });
      }
    }).catch(() => {});
  }, [projectId]);

  // ── Load slides from artifact or localStorage ─────────────────────────────
  useEffect(() => {
    if (!artifacts.length) { setLoadingSlides(false); return; }

    // Try localStorage first
    const saved = projectId ? localStorage.getItem(`slides_${projectId}`) : null;
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Slide[];
        if (parsed.length > 0) { dispatch({ type: 'SET', slides: parsed }); setLoadingSlides(false); return; }
      } catch { /* fall through */ }
    }

    const presArt = artifacts.find(a => a.artifact_type === 'presentation' || a.artifact_type === 'presentation_pptx');
    if (!presArt) { dispatch({ type: 'SET', slides: getDefaultSlides() }); setLoadingSlides(false); return; }

    try {
      const data = typeof presArt.content === 'string' ? JSON.parse(presArt.content) : presArt.content;
      const rawSlides: Slide[] = [];

      if (data.slides?.length) {
        data.slides.forEach((s: any, i: number) => rawSlides.push({
          id: String(i), title: s.title || '', subtitle: s.subtitle || '',
          content: s.content || s.body || '', speaker_notes: s.speaker_notes || s.narration || '',
          layout: (s.layout || (i === 0 ? 'title' : 'content')) as SlideLayout, duration: s.duration || 30,
        }));
      } else if (data.slide_outline?.length) {
        const notes: Record<number, string> = {};
        (data.speaker_notes || []).forEach((n: any) => { notes[n.slide_number || 0] = n.notes || ''; });
        data.slide_outline.forEach((item: any, i: number) => rawSlides.push({
          id: String(i), title: item.title || '', subtitle: item.subtitle || '',
          content: (item.key_points || []).map((p: string) => `• ${p}`).join('\n'),
          speaker_notes: notes[item.slide_number || i + 1] || '',
          layout: (i === 0 ? 'title' : item.slide_type || 'content') as SlideLayout, duration: 30,
        }));
      }

      dispatch({ type: 'SET', slides: rawSlides.length ? rawSlides : getDefaultSlides() });
    } catch { dispatch({ type: 'SET', slides: getDefaultSlides() }); }
    setLoadingSlides(false);
  }, [artifacts, projectId]);

  // ── Auto-save to localStorage ─────────────────────────────────────────────
  useEffect(() => {
    if (!projectId || !slides.length) return;
    const t = setTimeout(() => localStorage.setItem(`slides_${projectId}`, JSON.stringify(slides)), 1500);
    return () => clearTimeout(t);
  }, [slides, projectId]);

  // ── Poll render job ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!jobId) return;
    pollRef.current = setInterval(async () => {
      try {
        const status = await fastApiRequest<RenderJob>(`/video/render/status/${jobId}`);
        setRenderJob(status);
        if (status.status === 'completed') {
          clearInterval(pollRef.current!);
          setRendering(false);
          addToast('Video rendered successfully!', 'success');
          setTab('video');
          if (status.video_artifact_id) {
            setExistingVideo({ video_artifact_id: status.video_artifact_id, duration_seconds: status.duration_seconds });
          }
        } else if (status.status === 'failed') {
          clearInterval(pollRef.current!);
          setRendering(false);
          addToast(status.error || 'Render failed', 'error');
        }
      } catch { /* ignore */ }
    }, 1500);
    return () => clearInterval(pollRef.current!);
  }, [jobId, addToast]);

  // ── Slide helpers ─────────────────────────────────────────────────────────
  const updateSlide = useCallback((idx: number, field: keyof Slide, value: string | number) => {
    setSlides(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  }, [setSlides]);

  const addSlide = useCallback(() => {
    const s: Slide = { id: Date.now().toString(), title: 'New Slide', subtitle: '', content: '• Key point 1\n• Key point 2\n• Key point 3', speaker_notes: '', layout: 'content', duration: 30 };
    setSlides(prev => { const n = [...prev]; n.splice(activeIdx + 1, 0, s); return n; });
    setActiveIdx(prev => prev + 1);
  }, [activeIdx, setSlides]);

  const deleteSlide = useCallback(() => {
    if (slides.length <= 1) return;
    setSlides(prev => prev.filter((_, i) => i !== activeIdx));
    setActiveIdx(prev => Math.max(0, prev - 1));
  }, [slides.length, activeIdx, setSlides]);

  const duplicateSlide = useCallback(() => {
    const dup = { ...slides[activeIdx], id: Date.now().toString() };
    setSlides(prev => { const n = [...prev]; n.splice(activeIdx + 1, 0, dup); return n; });
    setActiveIdx(prev => prev + 1);
  }, [slides, activeIdx, setSlides]);

  const moveSlide = useCallback((from: number, to: number) => {
    setSlides(prev => { const n = [...prev]; const [r] = n.splice(from, 1); n.splice(to, 0, r); return n; });
    setActiveIdx(to);
  }, [setSlides]);

  // ── AI action ─────────────────────────────────────────────────────────────
  const applyAiAction = useCallback(async (action: AiAction) => {
    if (!slides[activeIdx]) return;
    setAiActionLoading(action);
    try {
      const res = await fastApiRequest<{ success: boolean; slide: Partial<Slide> }>('/media-studio/slide-action', {
        method: 'POST',
        body: { action, slide: slides[activeIdx], project_id: projectId },
      });
      if (res.success && res.slide) {
        setSlides(prev => prev.map((s, i) => i === activeIdx ? { ...s, ...res.slide } : s));
        addToast(`Applied: ${action.replace(/_/g, ' ')}`, 'success');
      }
    } catch { addToast('AI action failed', 'error'); }
    finally { setAiActionLoading(null); }
  }, [slides, activeIdx, projectId, setSlides, addToast]);

  // Apply an AI slide-action to a SPECIFIC slide index (used by chat)
  const applyAiActionToIndex = useCallback(async (idx: number, action: AiAction): Promise<boolean> => {
    if (!slides[idx]) return false;
    try {
      const res = await fastApiRequest<{ success: boolean; slide: Partial<Slide> }>('/media-studio/slide-action', {
        method: 'POST',
        body: { action, slide: slides[idx], project_id: projectId },
      });
      if (res.success && res.slide) {
        setSlides(prev => prev.map((s, i) => i === idx ? { ...s, ...res.slide } : s));
        return true;
      }
    } catch { /* fall through */ }
    return false;
  }, [slides, projectId, setSlides]);

  // ── AI Presentation Chat: parse natural language → edit the deck ───────────
  const handleChatCommand = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setChatMessages(prev => [...prev, { role: 'user', text }]);
    setChatInput('');
    setChatBusy(true);
    const say = (msg: string) => setChatMessages(prev => [...prev, { role: 'assistant', text: msg }]);
    const lc = text.toLowerCase();

    // Resolve target slide index: "slide N" (1-based) or "this/current" → activeIdx
    const slideNumMatch = lc.match(/slide\s+(\d+)/);
    const targetIdx = slideNumMatch ? Math.min(Math.max(parseInt(slideNumMatch[1], 10) - 1, 0), slides.length - 1) : activeIdx;

    try {
      // Theme change
      if (/\b(change|set|switch|use)\b.*\btheme\b/.test(lc) || /^theme\b/.test(lc)) {
        const themeMap: Array<[RegExp, ThemeId]> = [
          [/mckinsey|blue|consult/, 'mckinsey'],
          [/light|white/, 'ey_light'],
          [/minimal|purple|indigo/, 'minimal'],
          [/dark|ey|charcoal|black/, 'ey_dark'],
        ];
        const found = themeMap.find(([re]) => re.test(lc));
        const newTheme = found ? found[1] : 'ey_dark';
        setThemeId(newTheme);
        say(`✓ Theme changed to ${THEMES[newTheme].label}.`);
        return;
      }

      // Add slide
      if (/\badd\b.*\bslide\b|\bnew slide\b|\binsert\b.*\bslide\b/.test(lc)) {
        const afterMatch = lc.match(/after\s+slide\s+(\d+)/);
        const insertAt = afterMatch ? Math.min(parseInt(afterMatch[1], 10), slides.length) : (slideNumMatch ? targetIdx + 1 : activeIdx + 1);
        const ns: Slide = { id: Date.now().toString(), title: 'New Slide', subtitle: '', content: '• Key point 1\n• Key point 2\n• Key point 3', speaker_notes: '', layout: 'content', duration: 30 };
        setSlides(prev => { const n = [...prev]; n.splice(insertAt, 0, ns); return n; });
        setActiveIdx(insertAt);
        say(`✓ Added a new slide at position ${insertAt + 1}. You can now edit it.`);
        return;
      }

      // Delete slide
      if (/\bdelete\b.*\bslide\b|\bremove\b.*\bslide\b/.test(lc)) {
        if (slides.length <= 1) { say('✗ Cannot delete — at least one slide is required.'); return; }
        setSlides(prev => prev.filter((_, i) => i !== targetIdx));
        setActiveIdx(Math.max(0, targetIdx - 1));
        say(`✓ Deleted slide ${targetIdx + 1}.`);
        return;
      }

      // Duplicate slide
      if (/\bduplicate\b|\bcopy\b.*\bslide\b/.test(lc)) {
        const dup = { ...slides[targetIdx], id: Date.now().toString() };
        setSlides(prev => { const n = [...prev]; n.splice(targetIdx + 1, 0, dup); return n; });
        setActiveIdx(targetIdx + 1);
        say(`✓ Duplicated slide ${targetIdx + 1}.`);
        return;
      }

      // Content/style transforms → map to AI action, apply to target slide
      const actionMap: Array<[RegExp, AiAction, string]> = [
        [/executive|c-suite|leadership|board/, 'executive_style', 'Executive style'],
        [/technical|engineer|developer/, 'technical_style', 'Technical style'],
        [/investor|pitch|funding|roi/, 'investor_pitch', 'Investor pitch'],
        [/academic|scholarly|formal/, 'academic_style', 'Academic style'],
        [/beautif|polish|improve.*visual|clean up/, 'beautify', 'Beautify'],
        [/storytell|narrative|story/, 'storytelling', 'Storytelling'],
        [/shorten|concise|brief|trim|less/, 'shorten', 'Shorten'],
        [/expand|elaborate|more detail|longer/, 'expand', 'Expand'],
        [/rewrite|rephrase|reword/, 'rewrite', 'Rewrite'],
        [/regenerate|redo|remake|fresh/, 'regenerate', 'Regenerate'],
      ];
      const match = actionMap.find(([re]) => re.test(lc));
      if (match) {
        const [, action, label] = match;
        const ok = await applyAiActionToIndex(targetIdx, action);
        setActiveIdx(targetIdx);
        say(ok ? `✓ Applied ${label} to slide ${targetIdx + 1}.` : `✗ Could not apply ${label}. Try again.`);
        return;
      }

      // Diagram request
      if (/\b(diagram|architecture|flowchart|chart)\b/.test(lc)) {
        setShowDiagram(true);
        say('✓ Opened the diagram generator — pick a type and insert it into your slide.');
        return;
      }

      // Image request
      if (/\bimage|picture|photo|icon\b/.test(lc)) {
        say('ℹ Image insertion: use the slide editor to add visuals. AI image generation is applied during rendering for supported layouts.');
        return;
      }

      say('I can change styles (executive/technical/investor/academic), rewrite, shorten, expand, beautify, regenerate, add/delete/duplicate slides, change theme, or add diagrams. Try naming a slide, e.g. "rewrite slide 2 technically".');
    } finally {
      setChatBusy(false);
    }
  }, [slides, activeIdx, applyAiActionToIndex, setSlides]);

  // ── PDF → Video render ────────────────────────────────────────────────────
  const startPdfRender = useCallback(async () => {
    if (!projectId || !pdfFile) return;
    setRendering(true); setRenderJob(null);
    try {
      const form = new FormData();
      form.append('pdf_file', pdfFile);
      form.append('project_id', String(Number(projectId)));
      form.append('mode', videoMode);
      form.append('voice_id', voiceId);
      form.append('voice_speed', String(voiceSpeed));
      form.append('avatar_id', selectedAvatar);
      form.append('gen_mode', genMode);
      const response = await fetch(`${FASTAPI_BASE_URL}/video/render/from-pdf`, {
        method: 'POST', credentials: 'include', body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'PDF render failed');
      setJobId(data.job_id);
      setShowGenerateModal(false);
      setTab('render');
      addToast('PDF render started', 'success');
    } catch (e) {
      setRendering(false);
      addToast(e instanceof Error ? e.message : 'Failed to start render', 'error');
    }
  }, [projectId, pdfFile, videoMode, voiceId, voiceSpeed, selectedAvatar, genMode, addToast]);

  // ── Start render ──────────────────────────────────────────────────────────
  const startRender = useCallback(async () => {
    if (pdfMode && pdfFile) { startPdfRender(); return; }
    if (!projectId) return;
    setRendering(true); setRenderJob(null);
    try {
      const res = await fastApiRequest<{ job_id: string }>('/video/render', {
        method: 'POST',
        body: {
          project_id: Number(projectId),
          slides: slides.map(s => ({ title: s.title, subtitle: s.subtitle, content: s.content, speaker_notes: s.speaker_notes, layout: s.layout, duration: s.duration })),
          mode: videoMode, theme_id: themeId, voice_id: voiceId, voice_speed: voiceSpeed,
          avatar_id: selectedAvatar, gen_mode: genMode,
        },
      });
      setJobId(res.job_id);
      setShowGenerateModal(false);
      setTab('render');
      addToast('Render started', 'success');
    } catch (e) {
      setRendering(false);
      addToast(e instanceof Error ? e.message : 'Failed to start render', 'error');
    }
  }, [projectId, pdfMode, pdfFile, slides, videoMode, themeId, voiceId, voiceSpeed, selectedAvatar, genMode, addToast, startPdfRender]);

  const activeSlide = slides[activeIdx];
  const theme = THEMES[themeId];
  const displayVideoId = renderJob?.video_artifact_id ?? existingVideo?.video_artifact_id ?? null;
  const displayDuration = renderJob?.duration_seconds ?? existingVideo?.duration_seconds ?? 0;

  if (loadingSlides) return (
    <div className="flex h-full items-center justify-center py-24">
      <Loader2 className="h-8 w-8 animate-spin text-ey-yellow" />
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-64px-48px)] overflow-hidden -m-6">

      {/* ─ Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-dark-border bg-dark-card px-4 py-2 flex-shrink-0">
        <div className="flex items-center gap-1">
          {([
            { id: 'edit',   label: 'Editor',   icon: Palette },
            { id: 'render', label: 'Progress',  icon: Activity },
            { id: 'video',  label: 'Video',     icon: Video },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors relative ${
                tab === id ? 'bg-ey-yellow text-dark-bg font-semibold' : 'text-text-muted hover:text-text-primary hover:bg-dark-bg'
              }`}>
              <Icon className="h-4 w-4" />{label}
              {id === 'video' && displayVideoId && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-status-success border border-dark-card" />
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button onClick={() => dispatch({ type: 'UNDO' })} disabled={!canUndo} className="btn-ghost p-1.5 disabled:opacity-30" title="Undo">
            <Undo2 className="h-4 w-4" />
          </button>
          <button onClick={() => dispatch({ type: 'REDO' })} disabled={!canRedo} className="btn-ghost p-1.5 disabled:opacity-30" title="Redo">
            <Redo2 className="h-4 w-4" />
          </button>

          {tab === 'edit' && (
            <>
              <div className="h-5 w-px bg-dark-border mx-1" />
              <div className="flex items-center gap-1 rounded-lg border border-dark-border bg-dark-bg px-2 py-1">
                {Object.entries(THEMES).map(([id, t]) => (
                  <button key={id} onClick={() => setThemeId(id as ThemeId)} title={t.label}
                    className={`h-5 w-5 rounded-full border-2 transition-all ${themeId === id ? 'scale-125' : 'scale-100'}`}
                    style={{ backgroundColor: t.accent, borderColor: themeId === id ? '#fff' : 'transparent' }} />
                ))}
              </div>
              <button onClick={() => setEditing(!editing)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${editing ? 'bg-ey-yellow/10 text-ey-yellow border border-ey-yellow/30' : 'btn-ghost'}`}>
                <Type className="h-4 w-4" />{editing ? 'Editing ✓' : 'Edit'}
              </button>
            </>
          )}

          <div className="h-5 w-px bg-dark-border mx-1" />
          <button onClick={() => setShowDiagram(true)} className="btn-ghost text-sm flex items-center gap-1.5">
            <GitBranch className="h-4 w-4" />Diagram
          </button>
          <button onClick={() => setShowExport(true)} className="btn-ghost text-sm flex items-center gap-1.5">
            <Download className="h-4 w-4" />Export
          </button>
          <button onClick={() => setShowGenerateModal(true)} disabled={rendering || slides.length === 0} className="btn-primary text-sm">
            {rendering ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Rendering…</> : <><Sparkles className="mr-2 h-4 w-4" />Generate</>}
          </button>
        </div>
      </div>

      {/* ─ Editor tab ──────────────────────────────────────────────────────── */}
      {tab === 'edit' && slides.length > 0 && (
        <div className="flex flex-1 min-h-0">

          {/* Slide strip */}
          <div className="flex flex-col w-44 flex-shrink-0 border-r border-dark-border bg-dark-card">
            <div className="flex items-center justify-between px-3 py-2 border-b border-dark-border flex-shrink-0">
              <span className="text-xs text-text-muted">{slides.length} slides</span>
              <button onClick={addSlide} className="rounded p-1 text-text-muted hover:text-ey-yellow hover:bg-dark-bg">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {slides.map((slide, i) => (
                <div key={slide.id} className="relative group">
                  <SlideThumbnail slide={slide} themeId={themeId} slideNum={i+1} total={slides.length} active={i===activeIdx} onClick={() => setActiveIdx(i)} />
                  <div className="absolute top-0.5 right-0.5 hidden group-hover:flex gap-0.5 bg-dark-card/90 rounded p-0.5">
                    <button onClick={e => { e.stopPropagation(); setActiveIdx(i); setTimeout(duplicateSlide, 0); }} className="rounded p-0.5 text-text-muted hover:text-text-primary text-[10px]" title="Duplicate">⧉</button>
                    <button onClick={e => { e.stopPropagation(); if (i > 0) { setActiveIdx(i); moveSlide(i, i-1); }}} disabled={i===0} className="rounded p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30 text-[10px]">↑</button>
                    <button onClick={e => { e.stopPropagation(); if (i < slides.length-1) { setActiveIdx(i); moveSlide(i, i+1); }}} disabled={i===slides.length-1} className="rounded p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30 text-[10px]">↓</button>
                  </div>
                  <p className="text-[9px] text-text-muted text-center mt-0.5">{i+1} · {slide.duration||30}s</p>
                </div>
              ))}
            </div>
          </div>

          {/* Canvas */}
          <div className="flex-1 flex flex-col min-w-0 bg-dark-bg overflow-hidden">
            {activeSlide && (
              <div className="flex-1 overflow-auto p-4">
                <SlideCanvas slide={activeSlide} themeId={themeId} slideNum={activeIdx+1} total={slides.length} editing={editing}
                  onUpdate={(field, value) => updateSlide(activeIdx, field, value as string)} />
                <div className="flex items-center justify-center gap-4 mt-3">
                  <button onClick={() => setActiveIdx(Math.max(0, activeIdx-1))} disabled={activeIdx===0} className="btn-ghost p-2 disabled:opacity-30"><ChevronLeft className="h-5 w-5" /></button>
                  <span className="text-sm text-text-muted">{activeIdx+1} / {slides.length}</span>
                  <button onClick={() => setActiveIdx(Math.min(slides.length-1, activeIdx+1))} disabled={activeIdx===slides.length-1} className="btn-ghost p-2 disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button>
                </div>
              </div>
            )}
            <TimelineEditor slides={slides} onDurationChange={(idx, dur) => updateSlide(idx, 'duration', dur)} />
          </div>

          {/* Right panel */}
          <div className="flex flex-col w-64 flex-shrink-0 border-l border-dark-border bg-dark-card overflow-hidden">
            <div className="flex border-b border-dark-border flex-shrink-0">
              {([
                { id: 'layout', label: 'Layout', icon: Layout },
                { id: 'ai',     label: 'AI',     icon: Sparkles },
                { id: 'chat',   label: 'Chat',   icon: MessageSquare },
                { id: 'voice',  label: 'Voice',  icon: Mic },
                { id: 'avatar', label: 'Avatar', icon: User },
              ] as const).map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setRightPanel(id)}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] border-b-2 transition-colors ${rightPanel===id ? 'border-ey-yellow text-ey-yellow' : 'border-transparent text-text-muted hover:text-text-primary'}`}>
                  <Icon className="h-3.5 w-3.5" />{label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {rightPanel === 'layout' && (
                <div className="p-4 space-y-4">
                  <div>
                    <p className="text-xs text-text-muted font-medium uppercase tracking-wide mb-3">Layout</p>
                    <div className="grid grid-cols-2 gap-2">
                      {LAYOUTS.map(({ id, label, icon: Icon }) => (
                        <button key={id} onClick={() => activeSlide && updateSlide(activeIdx, 'layout', id)}
                          className={`flex flex-col items-center gap-1 rounded-lg border p-2 transition-all ${activeSlide?.layout===id ? 'border-ey-yellow bg-ey-yellow/10 text-ey-yellow' : 'border-dark-border text-text-muted hover:border-ey-yellow/30'}`}>
                          <Icon className="h-4 w-4" /><span className="text-[10px]">{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-dark-border pt-4">
                    <p className="text-xs text-text-muted font-medium uppercase tracking-wide mb-3">Actions</p>
                    <div className="space-y-1.5">
                      <button onClick={addSlide} className="btn-ghost w-full text-xs justify-start"><Plus className="mr-2 h-3.5 w-3.5" />Add Slide</button>
                      <button onClick={duplicateSlide} className="btn-ghost w-full text-xs justify-start"><Copy className="mr-2 h-3.5 w-3.5" />Duplicate</button>
                      <button onClick={deleteSlide} disabled={slides.length<=1} className="btn-ghost w-full text-xs justify-start text-status-error disabled:opacity-30"><Trash2 className="mr-2 h-3.5 w-3.5" />Delete</button>
                    </div>
                  </div>
                  <div className="border-t border-dark-border pt-4 space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-text-muted">Slides</span><span>{slides.length}</span></div>
                    <div className="flex justify-between"><span className="text-text-muted">Theme</span><span>{THEMES[themeId].label}</span></div>
                    <div className="flex justify-between"><span className="text-text-muted">Duration</span><span>{slides.reduce((s, sl) => s+(sl.duration||30), 0)}s</span></div>
                  </div>
                </div>
              )}

              {rightPanel === 'ai' && (
                <div className="p-4">
                  <p className="text-xs text-text-muted font-medium uppercase tracking-wide mb-3">AI Slide Actions</p>
                  <div className="space-y-1.5">
                    {AI_ACTIONS.map(action => (
                      <button key={action.id} onClick={() => applyAiAction(action.id)} disabled={aiActionLoading !== null}
                        className="w-full flex items-center gap-2.5 rounded-lg border border-dark-border bg-dark-bg p-2.5 hover:border-ey-yellow/40 transition-all text-left disabled:opacity-50">
                        <span className="text-base">{action.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-text-primary">{action.label}</p>
                          <p className="text-[10px] text-text-muted">{action.desc}</p>
                        </div>
                        {aiActionLoading === action.id && <Loader2 className="h-3 w-3 animate-spin text-ey-yellow flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {rightPanel === 'chat' && (
                <div className="flex flex-col h-full">
                  <div className="px-3 py-2 border-b border-dark-border flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 text-ey-yellow" />
                    <span className="text-xs font-medium text-text-primary">AI Presentation Chat</span>
                    <span className="text-[9px] text-text-muted ml-auto">slide {activeIdx + 1}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {chatMessages.map((m, i) => (
                      <div key={i} className={`text-[11px] leading-relaxed rounded-lg px-2.5 py-2 whitespace-pre-line ${
                        m.role === 'user' ? 'bg-ey-yellow/10 text-text-primary ml-4' : 'bg-dark-bg text-text-secondary mr-2'
                      }`}>{m.text}</div>
                    ))}
                    {chatBusy && <div className="flex items-center gap-1.5 text-[11px] text-text-muted"><Loader2 className="h-3 w-3 animate-spin" />Working…</div>}
                  </div>
                  <div className="p-2 border-t border-dark-border">
                    <div className="flex flex-wrap gap-1 mb-2">
                      {['Executive style', 'Shorten this', 'Add a slide', 'Change theme'].map(q => (
                        <button key={q} onClick={() => handleChatCommand(q === 'Executive style' ? 'Change this slide to executive style' : q === 'Shorten this' ? 'Shorten this slide' : q === 'Add a slide' ? 'Add a slide after this one' : 'Change theme to McKinsey')}
                          disabled={chatBusy}
                          className="text-[9px] px-2 py-1 rounded-full bg-dark-bg border border-dark-border text-text-muted hover:border-ey-yellow/40 hover:text-ey-yellow transition-colors">{q}</button>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !chatBusy) handleChatCommand(chatInput); }}
                        placeholder="e.g. rewrite slide 2 technically"
                        className="flex-1 text-[11px] bg-dark-bg border border-dark-border rounded-lg px-2.5 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-ey-yellow/40" />
                      <button onClick={() => handleChatCommand(chatInput)} disabled={chatBusy || !chatInput.trim()}
                        className="btn-primary px-2.5 py-2 disabled:opacity-40"><Send className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                </div>
              )}

              {rightPanel === 'voice' && (
                <div className="p-4 space-y-4">
                  <p className="text-xs text-text-muted font-medium uppercase tracking-wide">Voice Settings</p>
                  <div className="space-y-1.5">
                    {VOICES.map(v => (
                      <button key={v.id} onClick={() => setVoiceId(v.id)}
                        className={`w-full flex items-center gap-2 rounded-lg border p-2.5 text-left transition-all ${voiceId===v.id ? 'border-ey-yellow bg-ey-yellow/10' : 'border-dark-border hover:bg-dark-bg'}`}>
                        <Volume2 className={`h-3.5 w-3.5 flex-shrink-0 ${voiceId===v.id ? 'text-ey-yellow' : 'text-text-muted'}`} />
                        <div>
                          <p className={`text-xs font-medium ${voiceId===v.id ? 'text-ey-yellow' : 'text-text-primary'}`}>{v.label}</p>
                          <p className="text-[10px] text-text-muted">{v.gender==='F'?'♀':'♂'} {v.accent}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="text-xs text-text-muted mb-2 flex items-center justify-between">
                      <span>Speed</span><span className="text-ey-yellow">{voiceSpeed.toFixed(1)}x</span>
                    </label>
                    <input type="range" min={0.5} max={2.0} step={0.1} value={voiceSpeed}
                      onChange={e => setVoiceSpeed(Number(e.target.value))} className="w-full accent-ey-yellow" />
                    <div className="flex justify-between text-[10px] text-text-muted mt-1"><span>0.5x</span><span>Normal</span><span>2.0x</span></div>
                  </div>
                </div>
              )}

              {rightPanel === 'avatar' && (
                <div className="p-4 space-y-3">
                  <p className="text-xs text-text-muted font-medium uppercase tracking-wide">Avatar Presenter</p>
                  <div className="grid grid-cols-2 gap-2">
                    {AVATARS.map(a => (
                      <button key={a.id} onClick={() => setSelectedAvatar(a.id)}
                        className={`flex flex-col items-center gap-1 rounded-lg border p-2 transition-all ${selectedAvatar===a.id ? 'border-ey-yellow bg-ey-yellow/10' : 'border-dark-border hover:border-ey-yellow/30'}`}>
                        <span className="text-xl">{a.emoji}</span>
                        <span className={`text-[9px] text-center leading-tight ${selectedAvatar===a.id ? 'text-ey-yellow' : 'text-text-muted'}`}>{a.label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-text-muted text-center">SadTalker will use the selected persona</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─ Render tab ──────────────────────────────────────────────────────── */}
      {tab === 'render' && (
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {renderJob ? (
            <div className="space-y-6">
              <div className="rounded-xl border border-dark-border bg-dark-card p-6">
                <div className="flex items-center gap-3 mb-4">
                  {renderJob.status==='completed' ? <CheckCircle2 className="h-6 w-6 text-status-success" /> :
                   renderJob.status==='failed' ? <AlertTriangle className="h-6 w-6 text-status-error" /> :
                   <Loader2 className="h-6 w-6 animate-spin text-ey-yellow" />}
                  <div className="flex-1">
                    <h3 className="font-semibold text-text-primary">{renderJob.status==='completed' ? 'Render Complete' : renderJob.status==='failed' ? 'Render Failed' : renderJob.stage}</h3>
                    <p className="text-sm text-text-muted">{renderJob.message}</p>
                  </div>
                  <div className="text-2xl font-bold text-ey-yellow">{renderJob.percent}%</div>
                </div>
                <div className="flex gap-1 mb-3">
                  {PROGRESS_STAGES.map(s => (
                    <div key={s.label} className="flex-1 flex flex-col items-center gap-1">
                      <div className={`h-1.5 w-full rounded-full ${renderJob.percent>=s.pct?'bg-ey-yellow':'bg-dark-border'}`} />
                      <span className={`text-[8px] ${renderJob.percent>=s.pct?'text-ey-yellow':'text-text-muted'}`}>{s.label}</span>
                    </div>
                  ))}
                </div>
                <div className="h-2.5 rounded-full bg-dark-bg overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${renderJob.percent}%`, background: 'linear-gradient(90deg, #FFE600, #FFB300)' }} />
                </div>
                {renderJob.eta_seconds != null && renderJob.status==='running' && (
                  <p className="text-xs text-text-muted mt-2 flex items-center gap-1"><Clock className="h-3 w-3" />~{Math.ceil(renderJob.eta_seconds)}s remaining</p>
                )}
              </div>

              {renderJob.storyboard.length > 0 && (
                <div className="rounded-xl border border-dark-border bg-dark-card p-6">
                  <h3 className="section-title">Storyboard</h3>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                    {renderJob.storyboard.map(frame => (
                      <div key={frame.slide_idx}>
                        <div className="relative aspect-video rounded overflow-hidden bg-dark-bg border border-dark-border">
                          {frame.thumb_b64 ? <img src={`data:image/jpeg;base64,${frame.thumb_b64}`} alt={frame.title} className="w-full h-full object-cover" /> :
                           <div className="flex items-center justify-center h-full">{frame.status==='rendering' ? <Loader2 className="h-4 w-4 animate-spin text-ey-yellow" /> : <Monitor className="h-4 w-4 text-text-muted" />}</div>}
                        </div>
                        <p className="text-[9px] text-text-muted truncate mt-1">{frame.title||`Slide ${frame.slide_idx+1}`}</p>
                        {frame.audio_duration > 0 && <p className="text-[9px] text-text-muted"><Volume2 className="inline h-2.5 w-2.5" /> {frame.audio_duration.toFixed(1)}s</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {renderJob.fallback_used && (
                <div className="flex items-center gap-3 rounded-xl border border-status-warning/30 bg-status-warning/5 p-4">
                  <AlertTriangle className="h-5 w-5 text-status-warning flex-shrink-0" />
                  <p className="text-sm text-text-secondary">Avatar model unavailable — automatically using Slides + Voice-over.</p>
                </div>
              )}

              {renderJob.logs.length > 0 && (
                <div className="rounded-xl border border-dark-border bg-dark-card p-6">
                  <h3 className="section-title">Render Log</h3>
                  <div className="max-h-40 overflow-y-auto rounded-lg bg-dark-bg border border-dark-border p-3 font-mono text-[10px] text-text-muted">
                    {renderJob.logs.map((l, i) => <div key={i}>{l}</div>)}
                  </div>
                </div>
              )}

              {renderJob.status === 'completed' && (
                <button onClick={() => setTab('video')} className="btn-primary w-full"><Play className="mr-2 h-4 w-4" />Watch Video</button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Activity className="h-12 w-12 text-text-muted mb-4" />
              <h3 className="text-lg font-medium text-text-primary mb-2">No Active Render</h3>
              <p className="text-sm text-text-muted mb-6">Click Generate to start a render job.</p>
              <button onClick={() => setShowGenerateModal(true)} className="btn-primary"><Sparkles className="mr-2 h-4 w-4" />Generate</button>
            </div>
          )}
        </div>
      )}

      {/* ─ Video tab ───────────────────────────────────────────────────────── */}
      {tab === 'video' && (
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {displayVideoId ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-text-primary mb-1">Presentation Video</h2>
                <p className="text-sm text-text-muted">
                  {displayDuration > 0 ? `${displayDuration.toFixed(0)}s · ` : ''}
                  {(existingVideo?.slide_count && !renderJob ? existingVideo.slide_count : slides.length)} slides ·{' '}
                  {(() => {
                    const activeMode = renderJob ? videoMode : (existingVideo?.mode || videoMode);
                    if (renderJob?.fallback_used) return 'Slides + Voice-over (avatar fallback)';
                    return activeMode === 'avatar' ? 'AI Avatar + Voice-over'
                      : activeMode === 'animated' ? 'Animated Slides + Voice-over'
                      : activeMode === 'whiteboard' ? 'Whiteboard + Voice-over'
                      : 'Slides + Voice-over';
                  })()}
                  {existingVideo && !renderJob?.video_artifact_id && <span className="ml-2 text-[10px] text-text-muted bg-dark-border px-2 py-0.5 rounded-full">Previously generated</span>}
                </p>
              </div>
              <VideoPlayer artifactId={displayVideoId} />
              <div className="flex gap-3">
                <button onClick={() => { setRenderJob(null); setJobId(null); setShowGenerateModal(true); }} className="btn-secondary">
                  <RefreshCw className="mr-2 h-4 w-4" />Re-render
                </button>
                <button onClick={() => setShowExport(true)} className="btn-secondary">
                  <Download className="mr-2 h-4 w-4" />Export
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Play className="h-12 w-12 text-text-muted mb-4" />
              <h3 className="text-lg font-medium text-text-primary mb-2">No Video Generated Yet</h3>
              <p className="text-sm text-text-muted mb-6">Generate a video to watch it here.</p>
              <button onClick={() => setShowGenerateModal(true)} className="btn-primary"><Sparkles className="mr-2 h-4 w-4" />Generate Video</button>
            </div>
          )}
        </div>
      )}

      {/* ─ Generate modal ──────────────────────────────────────────────────── */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-dark-border bg-dark-card shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-dark-border px-6 py-4">
              <h2 className="text-lg font-bold text-text-primary">Generate Presentation</h2>
              <button onClick={() => setShowGenerateModal(false)} className="rounded-lg p-2 text-text-muted hover:bg-dark-bg"><X className="h-5 w-5" /></button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">

              {/* PDF upload option */}
              <div className="rounded-xl border-2 border-dashed border-dark-border bg-dark-bg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-ey-yellow" />
                    <span className="text-sm font-semibold text-text-primary">Generate from PDF</span>
                    <span className="text-xs text-text-muted bg-dark-border px-2 py-0.5 rounded-full">optional</span>
                  </div>
                  <label className="relative cursor-pointer">
                    <input ref={pdfInputRef} type="file" accept=".pdf" className="sr-only"
                      onChange={e => { const f = e.target.files?.[0] || null; setPdfFile(f); setPdfMode(!!f); }} />
                    <span className="btn-secondary text-xs px-3 py-1.5">Browse PDF</span>
                  </label>
                </div>
                {pdfFile ? (
                  <div className="flex items-center gap-2 rounded-lg bg-ey-yellow/10 border border-ey-yellow/30 px-3 py-2">
                    <FileText className="h-4 w-4 text-ey-yellow flex-shrink-0" />
                    <span className="text-sm text-ey-yellow font-medium flex-1 truncate">{pdfFile.name}</span>
                    <span className="text-xs text-text-muted">{(pdfFile.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button onClick={() => { setPdfFile(null); setPdfMode(false); if (pdfInputRef.current) pdfInputRef.current.value = ''; }}
                      className="text-text-muted hover:text-status-error ml-1"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted">Upload a PDF and the system will extract slides from it, add AI narration, and render a video — no manual slide building needed.</p>
                )}
              </div>

              {/* Gen mode */}
              <div>
                <p className="text-sm font-medium text-text-primary mb-3">Output Mode</p>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { id: 'presentation_only',  label: 'Presentation Only',  desc: 'Export PPTX/PDF',           icon: Presentation },
                    { id: 'presentation_video', label: 'Presentation + Video', desc: 'Full package with video',  icon: Film },
                    { id: 'video_only',         label: 'Video Only',          desc: 'Render directly to video', icon: Video },
                  ] as const).map(({ id, label, desc, icon: Icon }) => (
                    <button key={id} onClick={() => setGenMode(id)}
                      className={`rounded-xl border-2 p-3 text-left transition-all ${genMode===id ? 'border-ey-yellow bg-ey-yellow/10' : 'border-dark-border bg-dark-bg hover:border-ey-yellow/30'}`}>
                      <Icon className={`h-5 w-5 mb-2 ${genMode===id ? 'text-ey-yellow' : 'text-text-muted'}`} />
                      <p className={`text-xs font-semibold ${genMode===id ? 'text-ey-yellow' : 'text-text-primary'}`}>{label}</p>
                      <p className="text-[10px] text-text-muted mt-0.5">{desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {genMode !== 'presentation_only' && (
                <>
                  {/* Video style */}
                  <div>
                    <p className="text-sm font-medium text-text-primary mb-3">Video Style</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { id: 'slides',    label: 'Slides + Voice-over',    desc: 'Professional narrated slides', icon: Monitor },
                        { id: 'avatar',    label: 'AI Avatar (SadTalker)',   desc: 'Real lip-sync ~2-4 min',      icon: User },
                        { id: 'animated',  label: 'Animated Slides',         desc: 'Slide transitions & motion',  icon: Film },
                        { id: 'whiteboard',label: 'Whiteboard Style',        desc: 'Hand-drawn animation',        icon: FileText },
                      ] as const).map(({ id, label, desc, icon: Icon }) => (
                        <button key={id} onClick={() => setVideoMode(id)}
                          className={`rounded-xl border-2 p-3 text-left transition-all ${videoMode===id ? 'border-ey-yellow bg-ey-yellow/10' : 'border-dark-border bg-dark-bg hover:border-ey-yellow/30'}`}>
                          <Icon className={`h-5 w-5 mb-1.5 ${videoMode===id ? 'text-ey-yellow' : 'text-text-muted'}`} />
                          <p className={`text-xs font-semibold ${videoMode===id ? 'text-ey-yellow' : 'text-text-primary'}`}>{label}</p>
                          <p className="text-[10px] text-text-muted">{desc}</p>
                          {id==='avatar' && <p className="text-[9px] text-status-success mt-0.5">SadTalker · Local open-source</p>}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Voice */}
                  <div>
                    <p className="text-sm font-medium text-text-primary mb-3">Narrator Voice</p>
                    <div className="grid grid-cols-2 gap-2">
                      {VOICES.map(v => (
                        <button key={v.id} onClick={() => setVoiceId(v.id)}
                          className={`flex items-center gap-2 rounded-lg border p-2.5 text-left transition-all ${voiceId===v.id ? 'border-ey-yellow bg-ey-yellow/10' : 'border-dark-border hover:bg-dark-bg'}`}>
                          <Volume2 className={`h-4 w-4 flex-shrink-0 ${voiceId===v.id ? 'text-ey-yellow' : 'text-text-muted'}`} />
                          <div>
                            <p className={`text-sm font-medium ${voiceId===v.id ? 'text-ey-yellow' : 'text-text-primary'}`}>{v.label}</p>
                            <p className="text-xs text-text-muted">{v.gender==='F'?'♀':'♂'} {v.accent}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Avatar grid */}
                  {videoMode === 'avatar' && (
                    <div>
                      <p className="text-sm font-medium text-text-primary mb-3">Avatar Persona</p>
                      <div className="grid grid-cols-4 gap-2 max-h-44 overflow-y-auto">
                        {AVATARS.map(a => (
                          <button key={a.id} onClick={() => setSelectedAvatar(a.id)}
                            className={`flex flex-col items-center gap-1 rounded-lg border p-2 transition-all ${selectedAvatar===a.id ? 'border-ey-yellow bg-ey-yellow/10' : 'border-dark-border hover:border-ey-yellow/30'}`}>
                            <span className="text-xl">{a.emoji}</span>
                            <span className={`text-[9px] text-center leading-tight ${selectedAvatar===a.id ? 'text-ey-yellow' : 'text-text-muted'}`}>{a.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Summary */}
              <div className="flex items-center gap-3 rounded-lg border border-dark-border bg-dark-bg p-3">
                <Palette className="h-4 w-4 text-text-muted flex-shrink-0" />
                <p className="text-xs text-text-muted">
                  <span className="text-text-primary font-medium">{THEMES[themeId].label}</span> · {' '}
                  <span className="text-text-primary font-medium">{slides.length}</span> slides · {' '}
                  <span className="text-text-primary font-medium">{slides.reduce((s, sl) => s+(sl.duration||30), 0)}s</span> total
                </p>
              </div>
            </div>

            <div className="flex gap-3 border-t border-dark-border px-6 py-4">
              <button onClick={() => setShowGenerateModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={startRender} className="btn-primary flex-1">
                <Sparkles className="mr-2 h-4 w-4" />
                {pdfMode ? 'Generate from PDF' : genMode==='presentation_only' ? 'Generate PPTX' : genMode==='video_only' ? 'Render Video' : 'Generate All'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Render overlay */}
      {renderJob && rendering && <RenderProgress job={renderJob} onClose={() => setRendering(false)} />}

      {/* Export */}
      {showExport && <ExportPanel projectId={projectId} videoArtifactId={displayVideoId} slides={slides} onClose={() => setShowExport(false)} />}

      {/* Diagram */}
      {showDiagram && <DiagramGenerator projectId={projectId} onClose={() => setShowDiagram(false)}
        onInsert={code => { if (activeSlide) updateSlide(activeIdx, 'speaker_notes', (activeSlide.speaker_notes||'') + '\n\n[DIAGRAM]\n' + code); }} />}
    </div>
  );
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

function getDefaultSlides(): Slide[] {
  return [
    { id: '0', layout: 'title',   title: 'SDLC Autonomous Platform', subtitle: 'AI-driven software delivery from requirements to deployment', content: '', speaker_notes: 'Welcome to this presentation on our autonomous SDLC platform.', duration: 30 },
    { id: '1', layout: 'content', title: 'Project Overview',          subtitle: '', content: '• Full-stack platform with 15 AI agents\n• Human review checkpoints for governance\n• Real-time WebSocket progress tracking\n• React + FastAPI + PostgreSQL stack', speaker_notes: 'Our platform uses 15 specialized AI agents to drive the SDLC end to end.', duration: 45 },
    { id: '2', layout: 'content', title: 'Architecture Highlights',   subtitle: '', content: '• React SPA with TypeScript — responsive, accessible UI\n• FastAPI backend with async endpoints and WebSockets\n• PostgreSQL for persistent state with full audit trail\n• Containerised with Docker, deployable on Kubernetes', speaker_notes: 'The architecture is designed for enterprise scale with real-time visibility.', duration: 45 },
    { id: '3', layout: 'metric',  title: 'Quality Coverage',          subtitle: '90%', content: 'Unit test coverage across all generated modules with 85% integration and 78% E2E coverage.', speaker_notes: 'Quality is enforced through automated testing at every stage.', duration: 30 },
    { id: '4', layout: 'content', title: 'Security & Compliance',     subtitle: '', content: '• OWASP Top 10 mitigations applied\n• SOC 2 Type II and ISO 27001 aligned\n• GDPR-compliant data handling and retention\n• AES-256 at rest, TLS 1.3 in transit', speaker_notes: 'Security and compliance are built in from day one, not added as an afterthought.', duration: 40 },
    { id: '5', layout: 'closing', title: 'Next Steps',                subtitle: 'Ready for production', content: '• Complete stakeholder walkthrough\n• Schedule staging deployment and UAT\n• Begin Phase 2 feature planning', speaker_notes: 'The platform is fully ready. Thank you for your attention.', duration: 30 },
  ];
}

export {};
