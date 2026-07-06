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
import { Card, StatusBadge, ProgressBar, PreviewBadge } from '../components/ui/Card';
import { Accordion, AccordionItem, BulletList, DataTable } from '../components/ui/Accordion';
import { CodeBlock } from '../components/ui/CodeBlock';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import type { TestReportContent, TestCaseSpec } from '../types/unified';
import { Boxes, Server, Globe2, MonitorSmartphone, Gauge, ShieldAlert, AlertOctagon, Database } from 'lucide-react';

export function TestingWorkspace() {
  const [activeTab, setActiveTab] = useState<'overview' | 'suites' | 'coverage' | 'cases'>('overview');
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
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-text-primary">Testing Workspace</h1>
          <PreviewBadge label="Preview — Agent Under Development" />
        </div>
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
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-primary">Testing Workspace</h1>
            <PreviewBadge label="Preview — Agent Under Development" />
          </div>
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
          { id: 'cases', label: 'Detailed Test Cases', icon: Boxes },
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

      {/* Detailed Test Cases tab */}
      {activeTab === 'cases' && (
        <Card>
          {!testReport.unit_tests?.length && !testReport.integration_tests?.length && !testReport.api_tests?.length &&
           !testReport.ui_tests?.length && !testReport.performance_tests?.length && !testReport.security_tests?.length &&
           !testReport.edge_cases?.length && !testReport.test_data?.length ? (
            <div className="py-8 text-center">
              <Boxes className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
              <p className="text-sm text-text-muted">No detailed test cases generated yet.</p>
            </div>
          ) : (
            <Accordion>
              {renderTestCaseSection('Unit Tests', Boxes, testReport.unit_tests)}
              {renderTestCaseSection('Integration Tests', Server, testReport.integration_tests)}
              {renderTestCaseSection('API Tests', Globe2, testReport.api_tests)}
              {renderTestCaseSection('UI Tests', MonitorSmartphone, testReport.ui_tests)}
              {renderTestCaseSection('Performance Tests', Gauge, testReport.performance_tests)}
              {renderTestCaseSection('Security Tests', ShieldAlert, testReport.security_tests)}
              {!!testReport.edge_cases?.length && (
                <AccordionItem title="Edge Cases" icon={AlertOctagon} badge={<span className="text-[10px] text-text-muted">{testReport.edge_cases.length}</span>}>
                  <BulletList items={testReport.edge_cases} />
                </AccordionItem>
              )}
              {!!testReport.test_data?.length && (
                <AccordionItem title="Test Data" icon={Database} badge={<span className="text-[10px] text-text-muted">{testReport.test_data.length}</span>}>
                  <div className="space-y-3">
                    {testReport.test_data.map((td, i) => (
                      <div key={i}>
                        <p className="text-xs font-medium text-text-primary mb-1">{td.entity} <span className="text-text-muted font-normal">— {td.purpose}</span></p>
                        <CodeBlock language="json" code={JSON.stringify(td.sample_payload || {}, null, 2)} maxHeight="200px" />
                      </div>
                    ))}
                  </div>
                </AccordionItem>
              )}
            </Accordion>
          )}
        </Card>
      )}
    </div>
  );

  function renderTestCaseSection(title: string, icon: any, cases?: TestCaseSpec[]) {
    if (!cases || cases.length === 0) return null;
    return (
      <AccordionItem title={title} icon={icon} badge={<span className="text-[10px] text-text-muted">{cases.length}</span>}>
        <DataTable
          columns={['ID', 'Name', 'Target', 'Scenario', 'Expected Result']}
          rows={cases.map((c) => ({
            ID: <span className="font-mono">{c.id}</span>,
            Name: c.name,
            Target: c.target,
            Scenario: c.scenario,
            'Expected Result': c.expected_result,
          }))}
        />
      </AccordionItem>
    );
  }
}