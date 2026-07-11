import { useState } from 'react';
import {
  Code2,
  FileCode,
  FolderTree,
  FileJson,
  FileType,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Copy,
  Eye,
} from 'lucide-react';
import { Card, StatusBadge } from '../components/ui/Card';
import { Accordion, AccordionItem, BulletList, DataTable } from '../components/ui/Accordion';
import { RegenerateButton } from '../components/ui/RegenerateButton';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import type { CodeFile } from '../types/unified';
import { Layers, Route, Boxes, ListChecks, ShieldAlert, Puzzle } from 'lucide-react';

export function FrontendWorkspace() {
  const [activeTab, setActiveTab] = useState<'overview' | 'files' | 'structure' | 'architecture'>('overview');
  const [selectedFile, setSelectedFile] = useState<CodeFile | null>(null);
  const projectId = getSelectedProjectId();
  const { getGeneratedCode, loading, error, reload } = useUnifiedArtifacts(projectId);

  const frontendCode = getGeneratedCode('frontend');

  const handleExport = async (format: 'json' | 'md') => {
    if (!projectId || !frontendCode) return;
    try {
      const content = JSON.stringify(frontendCode, null, 2);
      const blob = new Blob([content], { type: 'application/json' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `frontend_code_${projectId}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  const handleCopyCode = (file: CodeFile) => {
    navigator.clipboard.writeText(file.content);
  };

  if (!projectId) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <AlertTriangle className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">No project selected</p>
          <p className="text-xs text-text-muted mt-1">Select a project in the Dashboard to view frontend code.</p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <RefreshCw className="h-10 w-10 text-ey-yellow animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-muted">Loading frontend code...</p>
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

  if (!frontendCode) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-text-primary">Frontend Workspace</h1>
        </div>
        <Card className="py-10 text-center space-y-3">
          <Code2 className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm text-text-muted">No frontend code generated yet.</p>
          <p className="text-xs text-text-muted mt-1">Run the Frontend Agent to generate React components and pages.</p>
          {projectId && (
            <RegenerateButton
              projectId={projectId}
              agentName="Frontend Agent"
              onRegenerated={reload}
              label="Generate"
              className="btn-primary text-sm"
              align="center"
            />
          )}
        </Card>
      </div>
    );
  }

  const metrics = [
    { label: 'Framework', value: frontendCode.framework || 'N/A', icon: Code2, color: 'text-status-info' },
    { label: 'Modules', value: frontendCode.modules?.length || 0, icon: FolderTree, color: 'text-status-success' },
    { label: 'Files', value: frontendCode.files?.length || 0, icon: FileCode, color: 'text-status-warning' },
    { label: 'Lines', value: frontendCode.files?.reduce((acc, f) => acc + (f.content?.split('\n').length || 0), 0) || 0, icon: Code2, color: 'text-ey-yellow' },
  ];

  const hasFiles = (frontendCode.files?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-primary">Frontend Workspace</h1>
          </div>
          <p className="mt-1 text-sm text-text-muted">React components, pages, and application code</p>
        </div>
        <div className="flex items-center gap-2">
          {hasFiles ? (
            <StatusBadge status="success">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Code Generated
            </StatusBadge>
          ) : (
            <StatusBadge status="error">
              <AlertTriangle className="mr-1 h-3 w-3" />
              Generation Failed
            </StatusBadge>
          )}
          {projectId && (
            <RegenerateButton projectId={projectId} agentName="Frontend Agent" onRegenerated={reload} />
          )}
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
          { id: 'overview', label: 'Overview', icon: Eye },
          { id: 'files', label: 'Files', icon: FileCode },
          { id: 'structure', label: 'Structure', icon: FolderTree },
          { id: 'architecture', label: 'Full Architecture', icon: Layers },
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
            <h3 className="text-lg font-semibold text-text-primary">Project Overview</h3>
          </div>
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Framework</h4>
              <p className="text-sm text-text-secondary">{frontendCode.framework}</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Implementation</h4>
              <p className="text-sm text-text-secondary">{frontendCode.implementation}</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Modules</h4>
              <div className="flex flex-wrap gap-2">
                {frontendCode.modules?.map((module, idx) => (
                  <span key={idx} className="text-xs px-3 py-1 rounded-full bg-status-info/10 text-status-info">{module}</span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Files tab */}
      {activeTab === 'files' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <FileCode className="h-5 w-5 text-ey-yellow" />
              <h3 className="text-lg font-semibold text-text-primary">Generated Files</h3>
            </div>
            <div className="space-y-2">
              {frontendCode.files?.map((file, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedFile(file)}
                  className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedFile === file ? 'bg-ey-yellow/10 border border-ey-yellow' : 'bg-dark-bg border border-dark-border hover:border-dark-border-light'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <FileCode className="h-4 w-4 text-ey-yellow" />
                    <div>
                      <p className="text-sm font-medium text-text-primary">{file.name}</p>
                      <p className="text-[10px] text-text-muted">{file.path}</p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCopyCode(file); }}
                    className="p-1 rounded hover:bg-dark-surface text-text-muted hover:text-ey-yellow"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </Card>

          {selectedFile && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-text-primary">{selectedFile.name}</h3>
                <button onClick={() => handleCopyCode(selectedFile)} className="btn-ghost text-xs">
                  <Copy className="mr-1 h-3 w-3" />
                  Copy
                </button>
              </div>
              <pre className="bg-dark-bg p-4 rounded-lg overflow-auto max-h-96 text-xs text-text-secondary">
                <code>{selectedFile.content}</code>
              </pre>
            </Card>
          )}
        </div>
      )}

      {/* Structure tab */}
      {activeTab === 'structure' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <FolderTree className="h-5 w-5 text-ey-yellow" />
            <h3 className="text-lg font-semibold text-text-primary">Project Structure</h3>
          </div>
          {frontendCode.folder_structure && frontendCode.folder_structure.length > 0 ? (
            <div className="space-y-1 font-mono text-xs mb-4">
              {frontendCode.folder_structure.map((line, idx) => (
                <p key={idx} className="text-text-secondary">{line}</p>
              ))}
            </div>
          ) : null}
          <div className="space-y-2">
            {frontendCode.modules?.map((module, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-dark-bg">
                <FolderTree className="h-4 w-4 text-ey-yellow" />
                <span className="text-sm text-text-primary">{module}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Full Architecture tab */}
      {activeTab === 'architecture' && (
        <Card>
          {!frontendCode.component_architecture?.length && !frontendCode.routing?.length && !frontendCode.api_integration_plan?.length && !frontendCode.forms?.length && !frontendCode.reusable_components?.length ? (
            <div className="py-8 text-center">
              <Layers className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
              <p className="text-sm text-text-muted">No detailed frontend architecture generated yet.</p>
            </div>
          ) : (
            <Accordion>
              {!!frontendCode.component_architecture?.length && (
                <AccordionItem title="Component Architecture" icon={Boxes} defaultOpen badge={<span className="text-[10px] text-text-muted">{frontendCode.component_architecture.length}</span>}>
                  <div className="space-y-2">
                    {frontendCode.component_architecture.map((c, i) => (
                      <div key={i} className="rounded-lg bg-dark-bg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-text-primary">{c.name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-dark-border text-text-muted">{c.type}</span>
                        </div>
                        {c.responsibility && <p className="text-xs text-text-secondary">{c.responsibility}</p>}
                        {!!c.props?.length && <p className="text-[10px] text-text-muted mt-1 font-mono">props: {c.props.join(', ')}</p>}
                        {!!c.children?.length && <p className="text-[10px] text-text-muted font-mono">children: {c.children.join(', ')}</p>}
                      </div>
                    ))}
                  </div>
                </AccordionItem>
              )}
              {!!frontendCode.routing?.length && (
                <AccordionItem title="Routing" icon={Route} badge={<span className="text-[10px] text-text-muted">{frontendCode.routing.length}</span>}>
                  <DataTable
                    columns={['Path', 'Component', 'Guarded', 'Description']}
                    rows={frontendCode.routing.map((r) => ({
                      Path: <span className="font-mono">{r.path}</span>,
                      Component: r.component,
                      Guarded: r.guarded ? 'Yes' : 'No',
                      Description: r.description,
                    }))}
                  />
                </AccordionItem>
              )}
              {frontendCode.state_management?.approach && (
                <AccordionItem title="State Management" icon={Layers}>
                  <p className="text-xs text-text-primary font-medium mb-1">{frontendCode.state_management.approach}</p>
                  {frontendCode.state_management.rationale && <p className="text-xs text-text-secondary mb-2">{frontendCode.state_management.rationale}</p>}
                  {!!frontendCode.state_management.stores?.length && (
                    <div className="space-y-1">
                      {frontendCode.state_management.stores.map((s, i) => (
                        <p key={i} className="text-[11px] text-text-secondary"><span className="text-ey-yellow font-mono">{s.name}</span> — {s.purpose}</p>
                      ))}
                    </div>
                  )}
                </AccordionItem>
              )}
              {!!frontendCode.api_integration_plan?.length && (
                <AccordionItem title="API Integration Plan" icon={ListChecks} badge={<span className="text-[10px] text-text-muted">{frontendCode.api_integration_plan.length}</span>}>
                  <DataTable
                    columns={['Endpoint', 'Method', 'Hook', 'Error Handling']}
                    rows={frontendCode.api_integration_plan.map((a) => ({
                      Endpoint: <span className="font-mono">{a.endpoint}</span>,
                      Method: a.method,
                      Hook: <span className="font-mono">{a.hook_name}</span>,
                      'Error Handling': a.error_handling,
                    }))}
                  />
                </AccordionItem>
              )}
              {!!frontendCode.forms?.length && (
                <AccordionItem title="Forms" icon={Puzzle} badge={<span className="text-[10px] text-text-muted">{frontendCode.forms.length}</span>}>
                  <div className="space-y-2">
                    {frontendCode.forms.map((f, i) => (
                      <div key={i} className="rounded-lg bg-dark-bg p-3">
                        <p className="text-sm font-medium text-text-primary mb-1">{f.name}</p>
                        <div className="space-y-0.5">
                          {(f.fields || []).map((field, j) => (
                            <p key={j} className="text-[11px] text-text-secondary font-mono">{field.name}: {field.type} — {field.validation}</p>
                          ))}
                        </div>
                        {f.submit_behavior && <p className="text-[10px] text-text-muted mt-1">{f.submit_behavior}</p>}
                      </div>
                    ))}
                  </div>
                </AccordionItem>
              )}
              {!!frontendCode.error_handling?.length && (
                <AccordionItem title="Error Handling" icon={ShieldAlert}>
                  <BulletList items={frontendCode.error_handling} />
                </AccordionItem>
              )}
              {!!frontendCode.reusable_components?.length && (
                <AccordionItem title="Reusable Components" icon={Boxes} badge={<span className="text-[10px] text-text-muted">{frontendCode.reusable_components.length}</span>}>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {frontendCode.reusable_components.map((r, i) => (
                      <div key={i} className="rounded-lg bg-dark-bg p-3">
                        <p className="text-sm font-medium text-text-primary">{r.name}</p>
                        {r.purpose && <p className="text-xs text-text-secondary">{r.purpose}</p>}
                        {!!r.variants?.length && <p className="text-[10px] text-text-muted mt-1">variants: {r.variants.join(', ')}</p>}
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
}