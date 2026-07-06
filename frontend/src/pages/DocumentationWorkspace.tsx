import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  BookOpen,
  Download,
  FileJson,
  FileType,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Eye,
  Copy,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar } from '../components/ui/Card';
import { Accordion, AccordionItem } from '../components/ui/Accordion';
import { Markdown } from '../components/ui/Markdown';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import type { DocumentationContent } from '../types/unified';
import { Rocket, Download as DownloadIcon, Terminal, Code2, Activity, Wrench, HelpCircle, LifeBuoy } from 'lucide-react';

export function DocumentationWorkspace() {
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'formats' | 'guides' | 'help'>('overview');
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const projectId = getSelectedProjectId();
  const { getDocumentation, loading, error, reload, downloadArtifact } = useUnifiedArtifacts(projectId);

  const documentation = getDocumentation();

  const handleExport = async (format: 'json' | 'md') => {
    if (!projectId || !documentation) return;
    try {
      const content = JSON.stringify(documentation, null, 2);
      const blob = new Blob([content], { type: 'application/json' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `documentation_${projectId}.${format}`;
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
          <p className="text-xs text-text-muted mt-1">Select a project in the Dashboard to view documentation.</p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <RefreshCw className="h-10 w-10 text-ey-yellow animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-muted">Loading documentation...</p>
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

  if (!documentation) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <FileText className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm text-text-muted">No documentation generated yet.</p>
          <p className="text-xs text-text-muted mt-1">Run the Documentation Agent to generate project documentation.</p>
        </Card>
      </div>
    );
  }

  const metrics = [
    { label: 'Documents', value: documentation.documents?.length || 0, icon: BookOpen, color: 'text-status-info' },
    { label: 'Format', value: documentation.format || 'N/A', icon: FileText, color: 'text-status-success' },
    { label: 'Status', value: documentation.status || 'pending', icon: documentation.status === 'generated' ? CheckCircle2 : AlertTriangle, color: documentation.status === 'generated' ? 'text-status-success' : 'text-status-warning' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Documentation Workspace</h1>
          <p className="mt-1 text-sm text-text-muted">Project documentation, guides, and references</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={documentation.status === 'generated' ? 'success' : documentation.status === 'failed' ? 'error' : 'warning'}>
            {documentation.status === 'generated' ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <AlertTriangle className="mr-1 h-3 w-3" />}
            {documentation.status || 'Pending'}
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
          { id: 'overview', label: 'Overview', icon: Eye },
          { id: 'documents', label: 'Documents', icon: BookOpen },
          { id: 'formats', label: 'Formats', icon: FileText },
          { id: 'guides', label: 'Guides', icon: Rocket },
          { id: 'help', label: 'Troubleshooting & FAQs', icon: LifeBuoy },
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
            <Eye className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Documentation Overview</h3>
          </div>
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Format</h4>
              <p className="text-sm text-text-secondary">{documentation.format}</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Status</h4>
              <StatusBadge status={documentation.status === 'generated' ? 'success' : documentation.status === 'failed' ? 'error' : 'warning'}>
                {documentation.status}
              </StatusBadge>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Generated Documents</h4>
              <div className="flex flex-wrap gap-2">
                {documentation.documents?.map((doc, idx) => (
                  <span key={idx} className="text-xs px-3 py-1 rounded-full bg-status-info/10 text-status-info">{doc}</span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Documents tab */}
      {activeTab === 'documents' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Generated Documents</h3>
          </div>
          <div className="space-y-3">
            {documentation.documents?.map((doc, idx) => (
              <div
                key={idx}
                onClick={() => setSelectedDoc(doc)}
                className={`flex items-center justify-between p-4 rounded-lg cursor-pointer transition-colors ${
                  selectedDoc === doc ? 'bg-ey-yellow/10 border border-ey-yellow' : 'bg-dark-bg border border-dark-border hover:border-dark-border-light'
                }`}
              >
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-ey-yellow" />
                  <div>
                    <p className="text-sm font-medium text-text-primary">{doc}</p>
                    <p className="text-[10px] text-text-muted">Document {idx + 1} of {documentation.documents?.length}</p>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); downloadArtifact('documentation'); }}
                  className="p-2 rounded hover:bg-dark-surface text-text-muted hover:text-ey-yellow"
                >
                  <Download className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Formats tab */}
      {activeTab === 'formats' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <FileText className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Export Formats</h3>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 rounded-lg bg-dark-bg border border-dark-border">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-status-info" />
                <div>
                  <p className="text-sm font-medium text-text-primary">Markdown</p>
                  <p className="text-xs text-text-muted">Primary format for documentation</p>
                </div>
              </div>
              <StatusBadge status="success">Supported</StatusBadge>
            </div>
            <div className="flex items-center justify-between p-4 rounded-lg bg-dark-bg border border-dark-border">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-status-warning" />
                <div>
                  <p className="text-sm font-medium text-text-primary">PDF</p>
                  <p className="text-xs text-text-muted">Export for printing and sharing</p>
                </div>
              </div>
              <StatusBadge status="warning">Available</StatusBadge>
            </div>
            <div className="flex items-center justify-between p-4 rounded-lg bg-dark-bg border border-dark-border">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-status-success" />
                <div>
                  <p className="text-sm font-medium text-text-primary">HTML</p>
                  <p className="text-xs text-text-muted">Web-ready documentation</p>
                </div>
              </div>
              <StatusBadge status="success">Supported</StatusBadge>
            </div>
          </div>
        </Card>
      )}

      {/* Guides tab */}
      {activeTab === 'guides' && (
        <Card>
          {!documentation.developer_guide && !documentation.deployment_guide && !documentation.installation_guide &&
           !documentation.api_documentation && !documentation.operations_guide && !documentation.maintenance_guide ? (
            <div className="py-8 text-center">
              <Rocket className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
              <p className="text-sm text-text-muted">No detailed guides generated yet.</p>
            </div>
          ) : (
            <Accordion>
              {documentation.developer_guide && (
                <AccordionItem title="Developer Guide" icon={Code2} defaultOpen>
                  <Markdown content={documentation.developer_guide} />
                </AccordionItem>
              )}
              {documentation.installation_guide && (
                <AccordionItem title="Installation Guide" icon={DownloadIcon}>
                  <Markdown content={documentation.installation_guide} />
                </AccordionItem>
              )}
              {documentation.deployment_guide && (
                <AccordionItem title="Deployment Guide" icon={Rocket}>
                  <Markdown content={documentation.deployment_guide} />
                </AccordionItem>
              )}
              {documentation.api_documentation && (
                <AccordionItem title="API Documentation" icon={Terminal}>
                  <Markdown content={documentation.api_documentation} />
                </AccordionItem>
              )}
              {documentation.operations_guide && (
                <AccordionItem title="Operations Guide" icon={Activity}>
                  <Markdown content={documentation.operations_guide} />
                </AccordionItem>
              )}
              {documentation.maintenance_guide && (
                <AccordionItem title="Maintenance Guide" icon={Wrench}>
                  <Markdown content={documentation.maintenance_guide} />
                </AccordionItem>
              )}
            </Accordion>
          )}
        </Card>
      )}

      {/* Troubleshooting & FAQs tab */}
      {activeTab === 'help' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Wrench className="h-5 w-5 text-ey-yellow" />
              <h3 className="text-lg font-semibold text-text-primary">Troubleshooting</h3>
            </div>
            {!documentation.troubleshooting?.length ? (
              <p className="text-sm text-text-muted">No troubleshooting entries generated yet.</p>
            ) : (
              <div className="space-y-3">
                {documentation.troubleshooting.map((t, i) => (
                  <div key={i} className="rounded-lg bg-dark-bg p-3">
                    <p className="text-sm font-medium text-text-primary mb-1">{t.issue}</p>
                    {t.symptoms && <p className="text-xs text-text-secondary mb-1"><span className="text-text-muted">Symptoms:</span> {t.symptoms}</p>}
                    {t.resolution && <p className="text-xs text-status-success"><span className="text-text-muted">Resolution:</span> {t.resolution}</p>}
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <HelpCircle className="h-5 w-5 text-ey-yellow" />
              <h3 className="text-lg font-semibold text-text-primary">FAQs</h3>
            </div>
            {!documentation.faqs?.length ? (
              <p className="text-sm text-text-muted">No FAQs generated yet.</p>
            ) : (
              <div className="space-y-3">
                {documentation.faqs.map((f, i) => (
                  <div key={i} className="rounded-lg bg-dark-bg p-3">
                    <p className="text-sm font-medium text-text-primary mb-1">{f.question}</p>
                    {f.answer && <p className="text-xs text-text-secondary">{f.answer}</p>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}