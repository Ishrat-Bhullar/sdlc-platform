import { CheckCircle2, Clock } from 'lucide-react';
import { StatusBadge } from './Card';

/**
 * Shared approval-status badge + banner for agent workspaces.
 *
 * `status` is whatever getApprovalStatus()/getRawApproval() already returns
 * from the existing (unmodified) approvals data — 'Approved', 'Pending
 * Approval', or null when no approval record applies to this artifact.
 * Purely presentational: renders nothing when there's nothing to show, and
 * never triggers any approval action itself.
 */

export function ApprovalBadge({ status }: { status: string | null }) {
  if (!status) return null;
  if (status === 'Approved') {
    return (
      <StatusBadge status="success">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Approved
      </StatusBadge>
    );
  }
  return (
    <StatusBadge status="warning">
      <Clock className="mr-1 h-3 w-3" />
      Awaiting Approval
    </StatusBadge>
  );
}

export function ApprovalBanner({ status, note }: { status: string | null; note?: string }) {
  if (!status || status === 'Approved') return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-status-warning/30 bg-status-warning/5 px-4 py-2.5 text-xs text-status-warning">
      <Clock className="h-3.5 w-3.5 flex-shrink-0" />
      <span>{note || 'Review this output, then approve it from the Approval Center.'}</span>
    </div>
  );
}
