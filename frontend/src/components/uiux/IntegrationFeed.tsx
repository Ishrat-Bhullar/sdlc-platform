import { CheckCircle, Clock, Database, FileText, Layout, Network, Shield, Workflow } from 'lucide-react';
import type { Artifact } from '../../types/unified';

export interface PipelineStageStatus {
  key: string;
  label: string;
  status: string;
}

interface IntegrationFeedProps {
  artifacts: Artifact[];
  pipelineStages: PipelineStageStatus[];
}

const INPUT_ARTIFACT_TYPES: { type: string; label: string; icon: typeof FileText; color: string }[] = [
  { type: 'requirements_doc', label: 'Requirements', icon: FileText, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  { type: 'user_stories', label: 'User Stories', icon: Network, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  { type: 'architecture_diagram', label: 'Architecture', icon: Workflow, color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
  { type: 'sql_schema', label: 'Database Model', icon: Database, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
];

const OUTPUT_STAGE_KEYS: { key: string; label: string; icon: typeof Shield }[] = [
  { key: 'security', label: 'Security', icon: Shield },
  { key: 'compliance', label: 'Compliance', icon: CheckCircle },
  { key: 'frontend', label: 'Frontend', icon: Layout },
];

function statusLabel(status: string | undefined) {
  switch (status) {
    case 'completed': return 'SIGNED OFF';
    case 'running': return 'IN PROGRESS';
    case 'failed': return 'FAILED';
    case 'waiting_approval': return 'PENDING REVIEW';
    default: return 'WAITING';
  }
}

// Ported from Bhumika's "SDLC Orchestration" panel. Rewired from fully
// hardcoded fake IDs/status to real GeneratedArtifact rows (inputs) and real
// pipeline-status stage state (outputs) — both come from the actual backend
// via useUnifiedArtifacts / GET /projects/{id}/pipeline-status.
export function IntegrationFeed({ artifacts, pipelineStages }: IntegrationFeedProps) {
  const stageByKey = Object.fromEntries(pipelineStages.map((s) => [s.key, s]));

  return (
    <div className="bg-dark-card border border-dark-border rounded-2xl p-4.5 space-y-4 shadow-xl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-dark-border pb-3">
        <div>
          <h3 className="text-xs font-black uppercase tracking-wider text-text-primary">SDLC Pipeline Integration</h3>
          <p className="text-[10px] text-text-muted mt-0.5">Real artifacts and stage status from the running pipeline</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-center">
        <div className="xl:col-span-5 space-y-2">
          <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider block">Upstream Artifacts</span>
          <div className="grid grid-cols-2 gap-2">
            {INPUT_ARTIFACT_TYPES.map((inp) => {
              const artifact = artifacts.find((a) => a.artifact_type === inp.type);
              const Icon = inp.icon;
              return (
                <div key={inp.type} className="bg-dark-bg border border-dark-border rounded-xl p-2.5 flex items-center gap-2.5">
                  <div className={`p-1.5 rounded-lg border ${inp.color}`}><Icon size={14} /></div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold text-text-primary block truncate">{inp.label}</span>
                    {artifact ? (
                      <span className="text-[8px] font-mono text-status-success block">● Artifact #{artifact.id}</span>
                    ) : (
                      <span className="text-[8px] font-mono text-text-muted flex items-center gap-1"><Clock size={8} /> Not generated</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="xl:col-span-2 flex items-center justify-center">
          <div className="hidden xl:block h-10 w-[2px] bg-gradient-to-b from-ey-yellow to-blue-500" />
          <div className="xl:hidden h-[1px] w-full bg-gradient-to-r from-ey-yellow to-blue-500" />
        </div>

        <div className="xl:col-span-5 space-y-2">
          <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider block">Downstream Handoff</span>
          <div className="grid grid-cols-3 gap-2">
            {OUTPUT_STAGE_KEYS.map((out) => {
              const stage = stageByKey[out.key];
              const active = stage?.status === 'completed' || stage?.status === 'running';
              const Icon = out.icon;
              return (
                <div key={out.key} className={`border rounded-xl p-2.5 text-center flex flex-col items-center justify-between min-h-[80px] transition-all ${active ? 'bg-gradient-to-b from-dark-cardHover to-blue-950/20 border-blue-500/30' : 'bg-dark-bg border-dark-border opacity-60'}`}>
                  <div className={`p-1.5 rounded-lg border ${active ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-dark-cardHover border-dark-border text-zinc-600'}`}>
                    <Icon size={14} />
                  </div>
                  <span className="text-[9px] font-bold text-text-primary block truncate leading-tight mt-1.5">{out.label}</span>
                  <span className="text-[7px] font-mono font-black uppercase mt-1 px-1.5 py-0.5 rounded tracking-wide bg-dark-cardHover text-text-muted">{statusLabel(stage?.status)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
