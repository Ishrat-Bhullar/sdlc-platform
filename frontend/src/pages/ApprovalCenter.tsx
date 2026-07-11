import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Download,
  FileJson,
  FileType,
  Eye,
  Filter,
  Search,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar } from '../components/ui/Card';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import { apiRequest } from '../lib/api';
import type { Approval } from '../types/unified';

export function ApprovalCenter() {
  const [activeTab, setActiveTab] = useState<'pending' | 'all' | 'history'>('pending');
  const [selectedApproval, setSelectedApproval] = useState<Approval | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const projectId = getSelectedProjectId();
  const { artifacts, loading, error, reload, getApprovalStatus, isApproved, downloadArtifact } = useUnifiedArtifacts(projectId);

  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loadingApprovals, setLoadingApprovals] = useState(false);

  // Load approvals from API. /workflow/all-approvals returns every Approval
  // row regardless of status (pending/approved/rejected) — using the
  // pending-only endpoint here meant the "History"/"All" tabs and the
  // Approved/Rejected counters were permanently empty, since GeneratedArtifactOut
  // (what the artifacts-derived fallback below relied on) has no
  // approval_status field for the fallback to ever match on.
  const loadApprovals = useMemo(() => async () => {
    if (!projectId) return;
    setLoadingApprovals(true);
    try {
      const data = await apiRequest<Approval[]>(`/workflow/all-approvals?project_id=${projectId}`);
      setApprovals(data || []);
    } catch (e) {
      console.error('Failed to load approvals:', e);
    } finally {
      setLoadingApprovals(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  const filteredApprovals = useMemo(() => {
    let filtered = approvals;
    
    // Filter by tab
    if (activeTab === 'pending') {
      filtered = filtered.filter(a => a.status === 'Pending Approval');
    } else if (activeTab === 'history') {
      filtered = filtered.filter(a => a.status === 'Approved' || a.status === 'Rejected');
    }
    
    // Filter by type
    if (filterType !== 'all') {
      filtered = filtered.filter(a => a.artifact_type === filterType);
    }
    
    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(a => 
        a.artifact_type.toLowerCase().includes(query) ||
        a.id.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [approvals, activeTab, filterType, searchQuery]);

  const pendingCount = approvals.filter(a => a.status === 'Pending Approval').length;
  const approvedCount = approvals.filter(a => a.status === 'Approved').length;
  const rejectedCount = approvals.filter(a => a.status === 'Rejected').length;

  const handleApprove = async (approvalId: string) => {
    if (!projectId) return;
    try {
      await apiRequest(`/workflow/approvals/${approvalId}/decide`, {
        method: 'POST',
        body: { decision: 'approved', comments: 'Approved from Approval Center' }
      });
      reload();
      await loadApprovals();
    } catch (e) {
      console.error('Failed to approve:', e);
    }
  };

  const handleReject = async (approvalId: string) => {
    if (!projectId) return;
    try {
      await apiRequest(`/workflow/approvals/${approvalId}/decide`, {
        method: 'POST',
        body: { decision: 'rejected', comments: 'Rejected from Approval Center' }
      });
      reload();
      await loadApprovals();
    } catch (e) {
      console.error('Failed to reject:', e);
    }
  };

  const handleExport = async (format: 'json' | 'md') => {
    if (!projectId || !selectedApproval) return;
    try {
      await downloadArtifact(selectedApproval.artifact_type, format);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  if (!projectId) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <AlertTriangle className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">No project selected</p>
          <p className="text-xs text-text-muted mt-1">Select a project to view approvals.</p>
        </Card>
      </div>
    );
  }

  if (loading || loadingApprovals) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <RefreshCw className="h-10 w-10 text-ey-yellow animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-muted">Loading approvals...</p>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Card className="border-status-error/30 bg-status-error/5 text-sm text-status-error">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
            <button onClick={reload} className="ml-auto underline hover:no-underline">Retry</button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Approval Center</h1>
          <p className="mt-1 text-sm text-text-muted">Review and approve agent outputs</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reload} className="btn-ghost text-sm" disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="text-center py-3">
          <Clock className="h-5 w-5 text-status-warning mx-auto mb-1" />
          <p className="text-xl font-bold text-text-primary">{pendingCount}</p>
          <p className="text-[10px] text-text-muted">Pending</p>
        </Card>
        <Card className="text-center py-3">
          <CheckCircle2 className="h-5 w-5 text-status-success mx-auto mb-1" />
          <p className="text-xl font-bold text-text-primary">{approvedCount}</p>
          <p className="text-[10px] text-text-muted">Approved</p>
        </Card>
        <Card className="text-center py-3">
          <XCircle className="h-5 w-5 text-status-error mx-auto mb-1" />
          <p className="text-xl font-bold text-text-primary">{rejectedCount}</p>
          <p className="text-[10px] text-text-muted">Rejected</p>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <Search className="h-4 w-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search approvals..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field text-sm flex-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-text-muted" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="input-field text-sm"
            >
              <option value="all">All Types</option>
              <option value="requirements_doc">Requirements</option>
              <option value="architecture_diagram">Architecture</option>
              <option value="sql_schema">Database</option>
              <option value="security_report">Security</option>
              <option value="compliance_report">Compliance</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex border-b border-dark-border">
        {[
          { id: 'pending', label: 'Pending', icon: Clock },
          { id: 'all', label: 'All', icon: Eye },
          { id: 'history', label: 'History', icon: CheckCircle2 },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-ey-yellow text-ey-yellow'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Approvals list */}
      {filteredApprovals.length === 0 ? (
        <Card className="py-10 text-center">
          <CheckCircle2 className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm text-text-muted">No approvals found.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredApprovals.map((approval) => (
            <Card key={approval.id} className="hover:border-dark-border-light transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-sm font-medium text-text-primary capitalize">
                      {approval.artifact_type.replace(/_/g, ' ')}
                    </h4>
                    <StatusBadge status={
                      approval.status === 'Approved' ? 'success'
                      : approval.status === 'Rejected' ? 'error'
                      : approval.status === 'Pending Approval' ? 'warning'
                      : 'info'
                    }>
                      {approval.status}
                    </StatusBadge>
                  </div>
                  <p className="text-xs text-text-muted">
                    Created: {new Date(approval.created_at).toLocaleString()}
                  </p>
                  {approval.comments && (
                    <p className="text-xs text-text-secondary mt-1">
                      <span className="font-medium">Comments:</span> {approval.comments}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {approval.status === 'Pending Approval' && (
                    <>
                      <button
                        onClick={() => handleApprove(approval.id)}
                        className="btn-primary text-xs"
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(approval.id)}
                        className="btn-secondary text-xs"
                      >
                        <XCircle className="mr-1 h-3 w-3" />
                        Reject
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setSelectedApproval(approval)}
                    className="btn-ghost text-xs"
                  >
                    <Eye className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Selected approval detail modal */}
      {selectedApproval && (
        <Card className="border-ey-yellow/50 bg-ey-yellow/5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-text-primary capitalize">
              {selectedApproval.artifact_type.replace(/_/g, ' ')} Details
            </h3>
            <button onClick={() => setSelectedApproval(null)} className="btn-ghost text-xs">
              Close
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">Status</p>
              <StatusBadge status={
                selectedApproval.status === 'Approved' ? 'success'
                : selectedApproval.status === 'Rejected' ? 'error'
                : 'warning'
              }>
                {selectedApproval.status}
              </StatusBadge>
            </div>
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">Created</p>
              <p className="text-sm text-text-primary">{new Date(selectedApproval.created_at).toLocaleString()}</p>
            </div>
            {selectedApproval.comments && (
              <div>
                <p className="text-xs font-medium text-text-muted mb-1">Comments</p>
                <p className="text-sm text-text-primary">{selectedApproval.comments}</p>
              </div>
            )}
            {selectedApproval.notes && (
              <div>
                <p className="text-xs font-medium text-text-muted mb-1">Notes</p>
                <p className="text-sm text-text-primary">{selectedApproval.notes}</p>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button onClick={() => handleExport('json')} className="btn-ghost text-xs">
                <FileJson className="mr-1 h-3 w-3" />
                Export JSON
              </button>
              <button onClick={() => handleExport('md')} className="btn-ghost text-xs">
                <FileType className="mr-1 h-3 w-3" />
                Export MD
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}