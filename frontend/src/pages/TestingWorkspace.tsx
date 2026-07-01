import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  TestTube,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Download,
  FileJson,
  FileType,
  RefreshCw,
  Play,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar } from '../components/ui/Card';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import type { TestReportContent } from '../types/unified';

export function TestingWorkspace() {
  const [activeTab, setActiveTab] = useState<'overview' | 'suites' | 'coverage'>('overview');
  const projectId = getSelectedProjectId();
  const { getTestReport, loading, error, reload, downloadArtifact } = useUnifiedArtifacts(projectId);

  const testReport = getTestReport();

  const handleExport = async (format: 'json' | 'md') => {
    if (!projectId || !testReport) return;
    try {
      const content = JSON.stringify(testReport, null, 2);
      const blob = new Blob([content], { type: 'application/json' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `test_report_${projectId}.${format}`;
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
          <p className="text-xs text-text-muted mt-1">Select a project in the Dashboard to view test report.</p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <RefreshCw className="h-10 w-10 text-ey-yellow animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-muted">Loading test report...</p>
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

  if (!testReport) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <TestTube className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm text-text-muted">No test report generated yet.</p>
          <p className="text-xs text-text-muted mt-1">Run the Testing Agent to generate test suites and coverage report.</p>
        </Card>
      </div>
    );
  }

  const metrics = [
    { label: 'Test Suites', value: testReport.suites?.length || 0, icon: TestTube, color: 'text-status-info' },
    { label: 'Status', value: testReport.status || 'pending', icon: testReport.status === 'passed' ? CheckCircle2 : XCircle, color: testReport.status === 'passed' ? 'text-status-success' : 'text-status-error' },
    { label: 'Coverage Targets', value: Object.keys(testReport.coverage_targets || {}).length, icon: Play, color: 'text-status-warning' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Testing Workspace</h1>
          <p className="mt-1 text-sm text-text-muted">Test suites, coverage, and quality metrics</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={testReport.status === 'passed' ? 'success' : testReport.status === 'failed' ? 'error' : 'warning'}>
            {testReport.status === 'passed' ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <AlertTriangle className="mr-1 h-3 w-3" />}
            {testReport.status || 'Pending'}
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
      <div className="grid gap-3 md:grid-cols-3">
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
          { id: 'overview', label: 'Overview', icon: Play },
          { id: 'suites', label: 'Test Suites', icon: TestTube },
          { id: 'coverage', label: 'Coverage', icon: CheckCircle2 },
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

      {/* Overview tab */}
      {activeTab === 'overview' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Play className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Test Summary</h3>
          </div>
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Summary</h4>
              <p className="text-sm text-text-secondary">{testReport.summary}</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Status</h4>
              <StatusBadge status={testReport.status === 'passed' ? 'success' : testReport.status === 'failed' ? 'error' : 'warning'}>
                {testReport.status}
              </StatusBadge>
            </div>
          </div>
        </Card>
      )}

      {/* Test Suites tab */}
      {activeTab === 'suites' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <TestTube className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Test Suites</h3>
          </div>
          <div className="space-y-3">
            {testReport.suites?.map((suite, idx) => (
              <div key={idx} className="flex items-start gap-3 rounded-lg bg-dark-bg p-4 border border-dark-border">
                <TestTube className="h-4 w-4 text-status-info mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">{suite}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Coverage tab */}
      {activeTab === 'coverage' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Coverage Targets</h3>
          </div>
          <div className="space-y-3">
            {Object.entries(testReport.coverage_targets || {}).map(([key, value]) => (
              <div key={key} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-text-primary capitalize">{key}</span>
                    <span className="text-xs text-text-muted">{value}%</span>
                  </div>
                  <div className="h-2 bg-dark-bg rounded-full overflow-hidden">
                    <div
                      className={`h-full ${value >= 80 ? 'bg-status-success' : value >= 50 ? 'bg-status-warning' : 'bg-status-error'}`}
                      style={{ width: `${value}%` }}
                    />
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