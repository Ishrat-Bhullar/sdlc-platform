import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Monitor,
  Smartphone,
  Tablet,
  MousePointer,
  Users,
  Zap,
  Download,
  FileJson,
  FileType,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar } from '../components/ui/Card';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import { buildApiUrl } from '../lib/api';
import type { UIUXDesignContent } from '../types/unified';

export function UIUXWorkspace() {
  const [activeTab, setActiveTab] = useState<'screens' | 'flows' | 'wireframes' | 'components' | 'recommendations'>('screens');
  const projectId = getSelectedProjectId();
  const { getUIUXDesign, loading, error, reload, downloadArtifact } = useUnifiedArtifacts(projectId);

  const design = getUIUXDesign();

  const handleExport = async (format: 'json' | 'md') => {
    if (!projectId || !design) return;
    try {
      const content = JSON.stringify(design, null, 2);
      const blob = new Blob([content], { type: 'application/json' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `uiux_design_${projectId}.${format}`;
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
          <p className="text-xs text-text-muted mt-1">Select a project in the Dashboard to view UI/UX design.</p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <RefreshCw className="h-10 w-10 text-ey-yellow animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-muted">Loading UI/UX design...</p>
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

  if (!design) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <Monitor className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm text-text-muted">No UI/UX design generated yet.</p>
          <p className="text-xs text-text-muted mt-1">Run the UI/UX Design Agent to generate screens, user flows, and wireframes.</p>
        </Card>
      </div>
    );
  }

  const metrics = [
    { label: 'Screens', value: design.screens?.length || 0, icon: Monitor, color: 'text-status-info' },
    { label: 'User Flows', value: design.userFlows?.length || 0, icon: Users, color: 'text-status-success' },
    { label: 'Wireframes', value: design.wireframes?.length || 0, icon: Tablet, color: 'text-status-warning' },
    { label: 'Recommendations', value: (design.componentRecommendations?.length || 0) + (design.uxRecommendations?.length || 0), icon: Zap, color: 'text-ey-yellow' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">UI/UX Design Workspace</h1>
          <p className="mt-1 text-sm text-text-muted">User interface and experience design artifacts</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status="success">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Design Generated
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
          { id: 'screens', label: 'Screens', icon: Monitor },
          { id: 'flows', label: 'User Flows', icon: Users },
          { id: 'wireframes', label: 'Wireframes', icon: Tablet },
          { id: 'components', label: 'Components', icon: MousePointer },
          { id: 'recommendations', label: 'Recommendations', icon: Zap },
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

      {/* Screens tab */}
      {activeTab === 'screens' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Monitor className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Application Screens</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {design.screens?.map((screen, idx) => (
              <div key={idx} className="rounded-lg bg-dark-bg p-4 border border-dark-border">
                <div className="flex items-center gap-2 mb-2">
                  <Smartphone className="h-4 w-4 text-ey-yellow" />
                  <h4 className="text-sm font-medium text-text-primary">{screen}</h4>
                </div>
                <p className="text-xs text-text-muted">Screen {idx + 1} of {design.screens?.length}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* User Flows tab */}
      {activeTab === 'flows' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">User Flows</h3>
          </div>
          <div className="space-y-3">
            {design.userFlows?.map((flow, idx) => (
              <div key={idx} className="rounded-lg bg-dark-bg p-4 border border-dark-border">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="h-6 w-6 rounded-full bg-ey-yellow/20 flex items-center justify-center text-xs font-bold text-ey-yellow">
                      {idx + 1}
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-text-primary">{flow}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Wireframes tab */}
      {activeTab === 'wireframes' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Tablet className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Wireframes</h3>
          </div>
          <div className="space-y-3">
            {design.wireframes?.map((wireframe, idx) => (
              <div key={idx} className="rounded-lg bg-dark-bg p-4 border border-dark-border">
                <p className="text-sm text-text-primary">{wireframe}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Components tab */}
      {activeTab === 'components' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <MousePointer className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Component Recommendations</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {design.componentRecommendations?.map((rec, idx) => (
              <div key={idx} className="rounded-lg bg-dark-bg p-3 border border-dark-border">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-status-success mt-0.5" />
                  <p className="text-xs text-text-primary">{rec}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recommendations tab */}
      {activeTab === 'recommendations' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">UX Recommendations</h3>
          </div>
          <div className="space-y-3">
            {design.uxRecommendations?.map((rec, idx) => (
              <div key={idx} className="rounded-lg bg-dark-bg p-4 border border-dark-border">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <Zap className="h-4 w-4 text-ey-yellow" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-text-primary">{rec}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}