/**
 * HumanApprovalModal.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Human-in-the-Loop checkpoint modal shown automatically after the Business
 * Analyst Agent completes.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  FileSearch,
  Briefcase,
  FileCheck,
  X,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { apiRequest } from '../lib/api';

interface HumanApprovalModalProps {
  projectId: string | number | null;
  open: boolean;
  artifacts: any[];
  onApproved: () => void;
  onRejected: () => void;
  onReviewLater: () => void;
}

function CheckItem({
  icon: Icon,
  label,
  present,
}: {
  icon: React.ElementType;
  label: string;
  present: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-dark-bg border border-dark-border px-4 py-3">
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0 ${
          present
            ? 'bg-status-success/15 border border-status-success/40'
            : 'bg-dark-border/30 border border-dark-border'
        }`}
      >
        <Icon className={`h-4 w-4 ${present ? 'text-status-success' : 'text-text-muted'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-medium ${
            present ? 'text-text-primary' : 'text-text-muted'
          }`}
        >
          {label}
        </p>
        <p className="text-[10px] text-text-muted mt-0.5">
          {present ? 'Generated & ready for review' : 'Not yet generated'}
        </p>
      </div>
      {present ? (
        <CheckCircle2 className="h-5 w-5 text-status-success flex-shrink-0" />
      ) : (
        <Clock className="h-4 w-4 text-text-muted flex-shrink-0" />
      )}
    </div>
  );
}

export function HumanApprovalModal({
  projectId,
  open,
  artifacts,
  onApproved,
  onRejected,
  onReviewLater,
}: HumanApprovalModalProps) {
  const [state, setState] = useState<'idle' | 'approving' | 'rejecting' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const artifactTypes = new Set(artifacts.map((a) => a.artifact_type));
  const hasRequirements = artifactTypes.has('requirements_doc');
  const hasUserStories = artifactTypes.has('user_stories');

  const hasAcceptance =
    artifactTypes.has('acceptance_criteria') ||
    artifacts.some((a) => {
      try {
        const c = typeof a.content === 'string' ? JSON.parse(a.content) : a.content;
        return Boolean(c && (c.acceptance_criteria || c.acceptanceCriteria));
      } catch {
        return false;
      }
    });

  const allGenerated = hasRequirements && hasUserStories;

  async function handleApprove() {
    if (!projectId) return;
    setState('approving');
    setError(null);
    try {
      await apiRequest('/workflow/resume', {
        method: 'POST',
        body: { project_id: projectId },
      });
      setState('done');
      setTimeout(() => {
        setState('idle');
        onApproved();
      }, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resume workflow');
      setState('idle');
    }
  }

  async function handleReject() {
    if (!projectId) return;
    setState('rejecting');
    setError(null);
    try {
      await apiRequest('/workflow/reject', {
        method: 'POST',
        body: { project_id: projectId, reason: 'Rejected at Human Review Checkpoint 1' },
      });
      setState('idle');
      onRejected();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject workflow');
      setState('idle');
    }
  }

  function handleReviewLater() {
    onReviewLater();
  }

  function handleBackdropClick() {
    if (state !== 'idle') return;
    handleReviewLater();
  }

  const modal = (
    <AnimatePresence>
      {open && (
        <motion.div
          key="ba-approval-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-dark-bg/80 backdrop-blur-sm"
          onClick={handleBackdropClick}
        >
          <motion.div
            key="ba-approval-panel"
            initial={{ opacity: 0, scale: 0.93, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.93, y: 16 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="bg-dark-card border border-dark-border rounded-xl w-full max-w-lg mx-4 overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-dark-border px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-status-warning/15 border border-status-warning/40">
                  <ShieldCheck className="h-5 w-5 text-status-warning" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-text-primary">Human Review Required</h2>
                  <p className="text-xs text-text-muted">Checkpoint 1 — Business Analyst completed</p>
                </div>
              </div>
              <button
                onClick={handleReviewLater}
                disabled={state !== 'idle'}
                className="rounded-lg p-1.5 text-text-muted hover:bg-dark-bg hover:text-text-primary transition-colors disabled:opacity-40"
                title="Review Later (workflow stays paused)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-5 space-y-5">
              <div className="flex items-start gap-3 rounded-lg bg-status-warning/10 border border-status-warning/30 px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-status-warning flex-shrink-0 mt-0.5" />
                <div className="text-xs text-status-warning leading-relaxed">
                  The autonomous pipeline has <strong>paused</strong> and is waiting for your
                  approval before proceeding to the Architecture phase.
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
                  Generated Deliverables
                </p>
                <div className="space-y-2">
                  <CheckItem icon={FileSearch} label="Functional Requirements" present={hasRequirements} />
                  <CheckItem icon={Briefcase} label="User Stories" present={hasUserStories} />
                  <CheckItem icon={FileCheck} label="Acceptance Criteria" present={hasAcceptance} />
                </div>
              </div>

              <div className="rounded-lg bg-dark-bg border border-dark-border px-4 py-3 text-xs text-text-muted space-y-1">
                <p>
                  <span className="text-status-success font-medium">Approve</span> → Pipeline resumes.
                </p>
                <p>
                  <span className="text-status-error font-medium">Reject</span> → Workflow resets to BA for revision.
                </p>
                <p>
                  <span className="text-text-secondary font-medium">Review Later</span> → Modal closes; pipeline stays paused.
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-lg bg-status-error/10 border border-status-error/30 px-3 py-2 text-xs text-status-error">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  {error}
                </div>
              )}

              {state === 'done' && (
                <div className="flex items-center gap-2 rounded-lg bg-status-success/10 border border-status-success/30 px-3 py-2 text-xs text-status-success">
                  <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                  Approved — resuming pipeline…
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-dark-border px-5 py-4 gap-3">
              <button
                onClick={handleReviewLater}
                disabled={state !== 'idle'}
                className="btn-ghost text-sm flex items-center gap-2 disabled:opacity-40"
              >
                <Clock className="h-4 w-4" />
                Review Later
              </button>

              <div className="flex items-center gap-2">
<button
                  onClick={handleReject}
                  disabled={state !== 'idle' || !projectId}
                  className="flex items-center gap-2 rounded-lg border border-status-error/40 bg-status-error/10 px-4 py-2 text-sm font-medium text-status-error hover:bg-status-error/20 transition-colors disabled:opacity-40"
                >
                  {state === 'rejecting' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  Reject
                </button>

                <button
                  onClick={handleApprove}
                  disabled={state !== 'idle' || !projectId || !allGenerated}
                  className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40"
                  title={!projectId ? 'No project selected' : !allGenerated ? 'Waiting for all deliverables to generate' : undefined}
                >
                  {state === 'approving' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {state === 'approving' ? 'Resuming…' : 'Approve'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(modal, document.body);
}

