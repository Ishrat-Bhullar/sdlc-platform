import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  FileCheck,
  AlertTriangle,
  Shield,
  Lock,
  CheckCircle2,
  Download,
  FileJson,
  FileType,
  RefreshCw,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar } from '../components/ui/Card';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import type { ComplianceReportContent } from '../types/unified';

export function ComplianceWorkspace() {
  const [activeTab, setActiveTab] = useState<'assessment' | 'governance' | 'audit' | 'retention'>('assessment');
  const projectId = getSelectedProjectId();
  const { getComplianceReport, loading, error, reload, downloadArtifact } = useUnifiedArtifacts(projectId);

  const compliance = getComplianceReport();

  const handleExport = async (format: 'json' | 'md') => {
    if (!projectId || !compliance) return;
    try {
      const content = JSON.stringify(compliance, null, 2);
      const blob = new Blob([content], { type: 'application/json' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `compliance_report_${projectId}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
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
          <p className="text-xs text-text-muted mt-1">Select a project in the Dashboard to view compliance report.</p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <RefreshCw className="h-10 w-10 text-ey-yellow animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-muted">Loading compliance report...</p>
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

  if (!compliance) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <FileCheck className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm text-text-muted">No compliance report generated yet.</p>
          <p className="text-xs text-text-muted mt-1">Run the Compliance Architect Agent to generate compliance assessment.</p>
        </Card>
      </div>
    );
  }

  const metrics = [
    { label: 'Standards', value: compliance.complianceAssessment?.standards?.length || 0, icon: Shield, color: 'text-status-info' },
    { label: 'Gaps', value: compliance.complianceAssessment?.gaps?.length || 0, icon: AlertTriangle, color: 'text-status-warning' },
    { label: 'Governance Controls', value: compliance.governanceControls?.length || 0, icon: Lock, color: 'text-status-success' },
    { label: 'Recommendations', value: compliance.complianceAssessment?.recommendations?.length || 0, icon: CheckCircle2, color: 'text-ey-yellow' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Compliance Workspace</h1>
          <p className="mt-1 text-sm text-text-muted">Compliance assessment, governance, and audit requirements</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status="success">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Report Generated
          </StatusBadge>
          <button onClick={reload} className="btn-ghost text-sm" disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <div className="flex items-center gap-1">
            <button onClick={() => handleExport('json')} className="btn-ghost text-xs" title="Export JSON">
              <FileJson className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => handleExport('md')} className="btn-ghost text-xs" title="Export Markdown">
              <FileType className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid gap-3 md:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label} className="text-center py-3">
            <metric.icon className={`h-5 w-5 ${metric.color} mx-auto mb-1`} />
            <p className="text-xl font-bold text-text-primary">{metric.value}</p>
            <p className="text-[10px] text-text-muted">{metric.label}</p>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-dark-border">
        {[
          { id: 'assessment', label: 'Assessment', icon: FileCheck },
          { id: 'governance', label: 'Governance', icon: Shield },
          { id: 'audit', label: 'Audit', icon: CheckCircle2 },
          { id: 'retention', label: 'Retention', icon: Lock },
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

      {/* Assessment tab */}
      {activeTab === 'assessment' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <FileCheck className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Compliance Assessment</h3>
          </div>
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Standards</h4>
              <div className="flex flex-wrap gap-2">
                {compliance.complianceAssessment?.standards?.map((standard, idx) => (
                  <span key={idx} className="text-xs px-3 py-1 rounded-full bg-status-info/10 text-status-info">{standard}</span>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Gaps</h4>
              <div className="space-y-2">
                {compliance.complianceAssessment?.gaps?.map((gap, idx) => (
                  <div key={idx} className="flex items-start gap-2 rounded-lg bg-dark-bg p-3">
                    <AlertTriangle className="h-4 w-4 text-status-warning mt-0.5" />
                    <p className="text-sm text-text-primary">{gap}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Recommendations</h4>
              <div className="space-y-2">
                {compliance.complianceAssessment?.recommendations?.map((rec, idx) => (
                  <div key={idx} className="flex items-start gap-2 rounded-lg bg-dark-bg p-3">
                    <CheckCircle2 className="h-4 w-4 text-status-success mt-0.5" />
                    <p className="text-sm text-text-primary">{rec}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Governance tab */}
      {activeTab === 'governance' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Shield className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Governance Controls</h3>
          </div>
          <div className="space-y-3">
            {compliance.governanceControls?.map((control, idx) => (
              <div key={idx} className="flex items-start gap-3 rounded-lg bg-dark-bg p-4 border border-dark-border">
                <Shield className="h-4 w-4 text-status-success mt-0.5" />
                <p className="text-sm text-text-primary">{control}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Audit tab */}
      {activeTab === 'audit' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Audit Requirements</h3>
          </div>
          <div className="space-y-3">
            {compliance.auditRequirements?.map((req, idx) => (
              <div key={idx} className="flex items-start gap-3 rounded-lg bg-dark-bg p-4 border border-dark-border">
                <CheckCircle2 className="h-4 w-4 text-status-info mt-0.5" />
                <p className="text-sm text-text-primary">{req}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Retention tab */}
      {activeTab === 'retention' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Lock className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Data Retention Policies</h3>
          </div>
          <div className="space-y-3">
            {compliance.dataRetentionPolicies?.map((policy, idx) => (
              <div key={idx} className="flex items-start gap-3 rounded-lg bg-dark-bg p-4 border border-dark-border">
                <Lock className="h-4 w-4 text-status-success mt-0.5" />
                <p className="text-sm text-text-primary">{policy}</p>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <h4 className="text-sm font-medium text-text-primary mb-2">Risk Assessment</h4>
            <div className="space-y-2">
              {compliance.riskAssessment?.map((risk, idx) => (
                <div key={idx} className="flex items-start gap-2 rounded-lg bg-status-warning/5 p-3 border border-status-warning/20">
                  <AlertTriangle className="h-4 w-4 text-status-warning mt-0.5" />
                  <p className="text-sm text-text-primary">{risk}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}