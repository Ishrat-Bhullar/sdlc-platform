/**
 * PresentationPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Presentation & Video Generation panel for the EY demo.
 * Shows live stage status (running / waiting_approval / completed / failed)
 * and provides download links for generated outputs.
 *
 * Reuses existing data from the Dashboard's agentRuns and artifacts arrays,
 * plus the pipeline-status endpoint that already includes the
 * `presentation_video_agent` stage.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileText,
  Video,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  UserCheck,
  ExternalLink,
  Presentation,
} from 'lucide-react';
import { apiRequest, BACKEND_ORIGIN } from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StageStatus = 'running' | 'waiting_approval' | 'completed' | 'failed' | 'queued' | 'pending';

export interface AgentRun {
  id: number;
  project_id: number;
  agent_name: string;
  status: string;
  start_time: string | null;
  end_time: string | null;
  output_url: string | null;
}

export interface Artifact {
  id: number;
  project_id: number;
  artifact_type: string;
  content: string | Record<string, unknown>;
  created_at: string;
}

export interface PresentationStatus {
  project_id: number;
  artifact_id: number | null;
  status: string;          // not_started | completed | failed
  generated_at: string | null;
  quality_score: number | null;
  total_slides: number | null;
  video_available: boolean;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface PresentationPanelProps {
  projectId: number | null;
  /** AgentRun for the presentation_video_agent (injected by parent) */
  presentationRun: AgentRun | undefined;
  /** All artifacts for this project (injected by parent) */
  artifacts: Artifact[];
  /** Callback to reload parent data */
  onRefresh?: () => void;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string }> = {
  completed: {
    icon: <CheckCircle2 className="h-5 w-5" />,
    label: 'Completed',
    color: 'text-status-success',
    bg: 'bg-status-success/10 border-status-success/30',
  },
  running: {
    icon: <Loader2 className="h-5 w-5 animate-spin" />,
    label: 'Running',
    color: 'text-status-info',
    bg: 'bg-status-info/10 border-status-info/30',
  },
  waiting_approval: {
    icon: <UserCheck className="h-5 w-5" />,
    label: 'Waiting for Approval',
    color: 'text-status-warning',
    bg: 'bg-status-warning/10 border-status-warning/30',
  },
  failed: {
    icon: <AlertCircle className="h-5 w-5" />,
    label: 'Failed',
    color: 'text-status-error',
    bg: 'bg-status-error/10 border-status-error/30',
  },
  pending: {
    icon: <Clock className="h-5 w-5" />,
    label: 'Pending',
    color: 'text-text-muted',
    bg: 'bg-dark-bg border-dark-border',
  },
  queued: {
    icon: <Clock className="h-5 w-5" />,
    label: 'Queued',
    color: 'text-text-muted',
    bg: 'bg-dark-bg border-dark-border',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseContent(raw: string | Record<string, unknown>): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return { raw_text: raw };
    }
  }
  return raw as Record<string, unknown>;
}

function getDownloadUrl(path: string): string {
  return `${BACKEND_ORIGIN}${path}`;
}

// ─── Attempt a fetch and return the blob URL for direct download ──────────────

async function fetchBlobAndDownload(path: string, filename: string): Promise<void> {
  const url = getDownloadUrl(path);
  try {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) {
      // Fallback: open the URL directly in a new tab
      window.open(url, '_blank');
      return;
    }
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    // Fallback to opening in new tab
    window.open(url, '_blank');
  }
}

/**
 * Download the presentation artifact content as a JSON file.
 * The content is fetched from the generated_artifacts endpoint.
 */
async function downloadPresentationJson(
  projectId: number,
  artifactId: number,
  filename: string,
): Promise<void> {
  try {
    const artifacts = await apiRequest<Artifact[]>(
      `/generated_artifacts?project_id=${projectId}`,
    );
    const presArtifact = artifacts.find(
      (a) => a.id === artifactId && a.artifact_type === 'presentation',
    );
    if (!presArtifact) {
      window.open(getDownloadUrl(`/generated_artifacts?project_id=${projectId}`), '_blank');
      return;
    }
    const content = parseContent(presArtifact.content);
    const jsonStr = JSON.stringify(content, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    // Fallback
    window.open(getDownloadUrl(`/generated_artifacts?project_id=${projectId}`), '_blank');
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PresentationPanel({
  projectId,
  presentationRun,
  artifacts,
  onRefresh,
}: PresentationPanelProps) {
  const [presentationStatus, setPresentationStatus] = useState<PresentationStatus | null>(null);
  const [loading, setLoading] = useState(false);

  // Derive stage status from the agent run
  const runStatus: StageStatus = (presentationRun?.status as StageStatus) || 'queued';
  const cfg = STATUS_CONFIG[runStatus] || STATUS_CONFIG.queued;

  // Find the presentation artifact
  const presArtifact = artifacts.find((a) => a.artifact_type === 'presentation');
  const pptxArtifact = artifacts.find((a) => a.artifact_type === 'presentation_pptx');

  // Parse presentation content for video URL
  const presContent = presArtifact ? parseContent(presArtifact.content) : {};
  const videoAvailable = presContent.video_available === true || presContent.video_available === 'true';
  const videoUrl = (presContent.video_url as string) || null;
  const qualityScore = presContent.quality_score != null ? Number(presContent.quality_score) : null;
  const totalSlides = presContent.total_slides != null ? Number(presContent.total_slides) : presArtifact ? 0 : null;

  // Fetch presentation status from backend
  const fetchStatus = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await apiRequest<PresentationStatus>(
        `/projects/${projectId}/presentation`,
      );
      setPresentationStatus(data);
    } catch {
      // Silently ignore — we derive status from agentRuns anyway
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (runStatus === 'completed') {
      fetchStatus();
    }
  }, [runStatus, fetchStatus]);

  // Download handlers
  const handleDownloadPptx = () => {
    if (pptxArtifact) {
      fetchBlobAndDownload(
        `/presentation/download/${pptxArtifact.id}`,
        `presentation_${projectId}.pptx`,
      );
    } else if (presArtifact) {
      fetchBlobAndDownload(
        `/presentation/download/${presArtifact.id}`,
        `presentation_${projectId}.pptx`,
      );
    } else if (presentationStatus?.artifact_id) {
      fetchBlobAndDownload(
        `/presentation/download/${presentationStatus.artifact_id}`,
        `presentation_${projectId}.pptx`,
      );
    }
  };

  const handleDownloadJson = () => {
    if (presArtifact) {
      downloadPresentationJson(
        projectId!,
        presArtifact.id,
        `presentation_${projectId}.json`,
      );
    }
  };

  const handleDownloadVideo = () => {
    if (videoUrl) {
      window.open(videoUrl, '_blank');
    }
  };

  if (!projectId) return null;

  const isCompleted = runStatus === 'completed';
  const isRunning = runStatus === 'running';
  const isFailed = runStatus === 'failed';
  const isWaiting = runStatus === 'waiting_approval';
  const hasOutputs = isCompleted && (presArtifact || pptxArtifact || presentationStatus?.artifact_id);

  return (
    <div className="rounded-xl border border-dark-border bg-dark-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-border">
        <Presentation className="h-5 w-5 text-ey-yellow" />
        <h3 className="text-sm font-semibold text-text-primary flex-1">
          Presentation & Video Generation
        </h3>
        {/* Status badge */}
        <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border ${cfg.bg} ${cfg.color}`}>
          {cfg.icon}
          <span>{cfg.label}</span>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-4">
        {/* Running state */}
        {isRunning && (
          <div className="flex items-center gap-3 rounded-lg bg-status-info/5 border border-status-info/20 px-4 py-3">
            <Loader2 className="h-5 w-5 animate-spin text-status-info" />
            <div>
              <p className="text-sm font-medium text-text-primary">Generating presentation & video</p>
              <p className="text-xs text-text-muted mt-0.5">
                Building executive summary, slide deck, speaker notes, and storyboard from pipeline artifacts…
              </p>
            </div>
          </div>
        )}

        {/* Waiting for approval state */}
        {isWaiting && (
          <div className="flex items-center gap-3 rounded-lg bg-status-warning/5 border border-status-warning/20 px-4 py-3">
            <UserCheck className="h-5 w-5 text-status-warning" />
            <div>
              <p className="text-sm font-medium text-text-primary">Awaiting human approval</p>
              <p className="text-xs text-text-muted mt-0.5">
                The presentation requires review before it can be published. Check the Approval Center.
              </p>
            </div>
          </div>
        )}

        {/* Failed state */}
        {isFailed && (
          <div className="flex items-center gap-3 rounded-lg bg-status-error/5 border border-status-error/20 px-4 py-3">
            <AlertCircle className="h-5 w-5 text-status-error" />
            <div>
              <p className="text-sm font-medium text-text-primary">Generation failed</p>
              <p className="text-xs text-text-muted mt-0.5">
                {presentationRun?.output_url
                  ? (() => {
                      try {
                        return JSON.parse(presentationRun.output_url).error || 'An unexpected error occurred.';
                      } catch {
                        return 'An unexpected error occurred.';
                      }
                    })()
                  : 'An unexpected error occurred.'}
              </p>
              <button
                onClick={onRefresh}
                className="mt-2 text-xs text-ey-yellow underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Pending / Queued state */}
        {!isCompleted && !isRunning && !isFailed && !isWaiting && (
          <div className="flex items-center gap-3 rounded-lg bg-dark-bg border border-dark-border px-4 py-3">
            <Clock className="h-5 w-5 text-text-muted" />
            <p className="text-sm text-text-muted">
              Presentation generation will start once prior pipeline stages complete.
            </p>
          </div>
        )}

        {/* Completed — Download section */}
        {isCompleted && (
          <div className="space-y-3">
            {/* Quality & slides summary */}
            {(qualityScore !== null || totalSlides !== null || presentationStatus?.total_slides) && (
              <div className="flex flex-wrap gap-3">
                {(qualityScore !== null) && (
                  <div className="rounded-lg bg-dark-bg border border-dark-border px-3 py-2">
                    <p className="text-[10px] text-text-muted">Quality Score</p>
                    <p className={`text-sm font-bold ${
                      qualityScore >= 80 ? 'text-status-success' : qualityScore >= 60 ? 'text-status-warning' : 'text-status-error'
                    }`}>
                      {qualityScore.toFixed(0)}%
                    </p>
                  </div>
                )}
                {(totalSlides !== null || presentationStatus?.total_slides) && (
                  <div className="rounded-lg bg-dark-bg border border-dark-border px-3 py-2">
                    <p className="text-[10px] text-text-muted">Total Slides</p>
                    <p className="text-sm font-bold text-text-primary">
                      {totalSlides ?? presentationStatus?.total_slides ?? 0}
                    </p>
                  </div>
                )}
                {presentationStatus?.generated_at && (
                  <div className="rounded-lg bg-dark-bg border border-dark-border px-3 py-2">
                    <p className="text-[10px] text-text-muted">Generated</p>
                    <p className="text-xs font-medium text-text-primary">
                      {new Date(presentationStatus.generated_at).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Download buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Download PPT */}
              <button
                onClick={handleDownloadPptx}
                disabled={!hasOutputs}
                className="flex items-center gap-2 rounded-lg border border-dark-border bg-dark-bg px-3 py-2.5 text-xs font-medium text-text-primary hover:border-ey-yellow/50 hover:bg-dark-surface transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <FileText className="h-4 w-4 text-ey-yellow" />
                <span className="flex-1 text-left">Download PPT</span>
                <Download className="h-3.5 w-3.5 text-text-muted" />
              </button>

              {/* Download Presentation JSON */}
              <button
                onClick={handleDownloadJson}
                disabled={!presArtifact}
                className="flex items-center gap-2 rounded-lg border border-dark-border bg-dark-bg px-3 py-2.5 text-xs font-medium text-text-primary hover:border-ey-yellow/50 hover:bg-dark-surface transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <FileText className="h-4 w-4 text-status-info" />
                <span className="flex-1 text-left">Download Presentation JSON</span>
                <Download className="h-3.5 w-3.5 text-text-muted" />
              </button>

              {/* Download Video (only if available) */}
              {(videoAvailable || videoUrl) && (
                <button
                  onClick={handleDownloadVideo}
                  className="sm:col-span-2 flex items-center gap-2 rounded-lg border border-status-success/30 bg-status-success/5 px-3 py-2.5 text-xs font-medium text-status-success hover:border-status-success/50 transition-all"
                >
                  <Video className="h-4 w-4" />
                  <span className="flex-1 text-left">
                    {videoUrl ? 'Watch Video Presentation' : 'Video Available'}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Presentation artifact ID reference */}
            {presArtifact && (
              <p className="text-[10px] text-text-muted text-center">
                Artifact #{presArtifact.id} ·{' '}
                {new Date(presArtifact.created_at).toLocaleString()}
              </p>
            )}
          </div>
        )}

        {/* Loading indicator for status fetch */}
        {loading && (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
          </div>
        )}
      </div>
    </div>
  );
}

export default PresentationPanel;