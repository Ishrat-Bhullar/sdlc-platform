import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Shield,
  AlertTriangle,
  Lock,
  Eye,
  Users,
  CheckCircle2,
  Download,
  FileJson,
  FileType,
  RefreshCw,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar } from '../components/ui/Card';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import type { SecurityReportContent } from '../types/unified';

export function SecurityWorkspace() {
  const [activeTab, setActiveTab] = useState<'architecture' | 'threats' | 'auth' | 'controls'>('architecture');
  const projectId = getSelectedProjectId();
  const { getSecurityReport, loading, error, reload, downloadArtifact } = useUnifiedArtifacts(projectId);

  const security = getSecurityReport();

  const handleExport = async (format: 'json' | 'md') => {
    if (!projectId || !security) return;
    try {
      const content = JSON.stringify(security, null, 2);
      const blob = new Blob([content], { type: 'application/json' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `security_report_${projectId}.${format}`;
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
          <p className="text-xs text-text-muted mt-1">Select a project in the Dashboard to view security report.</p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <RefreshCw className="h-10 w-10 text-ey-yellow animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-muted">Loading security report...</p>
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

  if (!security) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <Shield className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm text-text-muted">No security report generated yet.</p>
          <p className="text-xs text-text-muted mt-1">Run the Security Architect Agent to generate security architecture and threat model.</p>
        </Card>
      </div>
    );
  }

  const metrics = [
    { label: 'Security Layers', value: security.securityArchitecture?.layers?.length || 0, icon: Lock, color: 'text-status-info' },
    { label: 'Threats', value: security.threatModel?.length || 0, icon: AlertTriangle, color: 'text-status-error' },
    { label: 'Controls', value: security.securityControls?.length || 0, icon: Shield, color: 'text-status-success' },
    { label: 'Checklist Items', value: security.securityChecklist?.length || 0, icon: CheckCircle2, color: 'text-ey-yellow' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Security Workspace</h1>
          <p className="mt-1 text-sm text-text-muted">Security architecture, threat model, and controls</p>
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
          { id: 'architecture', label: 'Architecture', icon: Shield },
          { id: 'threats', label: 'Threat Model', icon: AlertTriangle },
          { id: 'auth', label: 'Authentication', icon: Lock },
          { id: 'controls', label: 'Controls', icon: CheckCircle2 },
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

      {/* Architecture tab */}
      {activeTab === 'architecture' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Shield className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Security Architecture</h3>
          </div>
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Layers</h4>
              <div className="flex flex-wrap gap-2">
                {security.securityArchitecture?.layers?.map((layer, idx) => (
                  <span key={idx} className="text-xs px-3 py-1 rounded-full bg-status-info/10 text-status-info">{layer}</span>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Controls</h4>
              <div className="flex flex-wrap gap-2">
                {security.securityArchitecture?.controls?.map((control, idx) => (
                  <span key={idx} className="text-xs px-3 py-1 rounded-full bg-status-success/10 text-status-success">{control}</span>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Patterns</h4>
              <div className="flex flex-wrap gap-2">
                {security.securityArchitecture?.patterns?.map((pattern, idx) => (
                  <span key={idx} className="text-xs px-3 py-1 rounded-full bg-ey-yellow/10 text-ey-yellow">{pattern}</span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Threat Model tab */}
      {activeTab === 'threats' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Threat Model</h3>
          </div>
          <div className="space-y-3">
            {security.threatModel?.map((threat, idx) => (
              <div key={idx} className="rounded-lg bg-dark-bg p-4 border border-dark-border">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-4 w-4 text-status-warning mt-0.5" />
                  <p className="text-sm text-text-primary">{threat}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Authentication tab */}
      {activeTab === 'auth' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Lock className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Authentication & Authorization</h3>
          </div>
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Authentication Strategy</h4>
              <p className="text-sm text-text-secondary">{security.authentication?.strategy}</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Providers</h4>
              <div className="flex flex-wrap gap-2">
                {security.authentication?.providers?.map((provider, idx) => (
                  <span key={idx} className="text-xs px-3 py-1 rounded-full bg-status-info/10 text-status-info">{provider}</span>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Authorization Model</h4>
              <p className="text-sm text-text-secondary">{security.authorization?.model}</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Roles</h4>
              <div className="flex flex-wrap gap-2">
                {security.authorization?.roles?.map((role, idx) => (
                  <span key={idx} className="text-xs px-3 py-1 rounded-full bg-status-success/10 text-status-success">{role}</span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Controls tab */}
      {activeTab === 'controls' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Security Controls & Checklist</h3>
          </div>
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Security Controls</h4>
              <div className="space-y-2">
                {security.securityControls?.map((control, idx) => (
                  <div key={idx} className="flex items-start gap-2 rounded-lg bg-dark-bg p-3">
                    <CheckCircle2 className="h-4 w-4 text-status-success mt-0.5" />
                    <p className="text-sm text-text-primary">{control}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Security Checklist</h4>
              <div className="space-y-2">
                {security.securityChecklist?.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 rounded-lg bg-dark-bg p-3">
                    <CheckCircle2 className="h-4 w-4 text-status-success mt-0.5" />
                    <p className="text-sm text-text-primary">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}