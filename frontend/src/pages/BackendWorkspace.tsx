import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Server,
  FileCode,
  FolderTree,
  Download,
  FileJson,
  FileType,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Copy,
  Eye,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar } from '../components/ui/Card';
import { Accordion, AccordionItem, BulletList, DataTable } from '../components/ui/Accordion';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { getSelectedProjectId } from '../lib/projectContext';
import type { CodeFile } from '../types/unified';
import { Layers, Lock, ShieldCheck, Database, Boxes, Clock3, AlertOctagon } from 'lucide-react';

export function BackendWorkspace() {
  const [activeTab, setActiveTab] = useState<'overview' | 'files' | 'structure' | 'architecture'>('overview');
  const [selectedFile, setSelectedFile] = useState<CodeFile | null>(null);
  const projectId = getSelectedProjectId();
  const { getGeneratedCode, loading, error, reload, downloadArtifact } = useUnifiedArtifacts(projectId);

  const backendCode = getGeneratedCode('backend');

  const handleExport = async (format: 'json' | 'md') => {
    if (!projectId || !backendCode) return;
    try {
      const content = JSON.stringify(backendCode, null, 2);
      const blob = new Blob([content], { type: 'application/json' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `backend_code_${projectId}.${format}`;
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
          <p className="text-xs text-text-muted mt-1">Select a project in the Dashboard to view backend code.</p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <RefreshCw className="h-10 w-10 text-ey-yellow animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-muted">Loading backend code...</p>
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

  if (!backendCode) {
    return (
      <div className="space-y-6">
        <Card className="py-10 text-center">
          <Server className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm text-text-muted">No backend code generated yet.</p>
          <p className="text-xs text-text-muted mt-1">Run the Backend Agent to generate API endpoints and services.</p>
        </Card>
      </div>
    );
  }

  const metrics = [
    { label: 'Framework', value: backendCode.framework || 'N/A', icon: Server, color: 'text-status-info' },
    { label: 'Modules', value: backendCode.modules?.length || 0, icon: FolderTree, color: 'text-status-success' },
    { label: 'Files', value: backendCode.files?.length || 0, icon: FileCode, color: 'text-status-warning' },
    { label: 'Lines', value: backendCode.files?.reduce((acc, f) => acc + (f.content?.split('\n').length || 0), 0) || 0, icon: Server, color: 'text-ey-yellow' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Backend Workspace</h1>
          <p className="mt-1 text-sm text-text-muted">API endpoints, services, and server-side code</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status="success">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Code Generated
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
              <p className="text-sm text-text-secondary">{backendCode.framework}</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Implementation</h4>
              <p className="text-sm text-text-secondary">{backendCode.implementation}</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">Modules</h4>
              <div className="flex flex-wrap gap-2">
                {backendCode.modules?.map((module, idx) => (
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
              {backendCode.files?.map((file, idx) => (
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
          <div className="space-y-2">
            {backendCode.modules?.map((module, idx) => (
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
          {!backendCode.api_specifications?.length && !backendCode.service_layer?.length && !backendCode.repository_layer?.length && !backendCode.authentication?.strategy ? (
            <div className="py-8 text-center">
              <Layers className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
              <p className="text-sm text-text-muted">No detailed backend architecture generated yet.</p>
            </div>
          ) : (
            <Accordion>
              {!!backendCode.api_specifications?.length && (
                <AccordionItem title="API Specifications" icon={Boxes} defaultOpen badge={<span className="text-[10px] text-text-muted">{backendCode.api_specifications.length}</span>}>
                  <DataTable
                    columns={['Method', 'Path', 'Summary', 'Status Codes']}
                    rows={backendCode.api_specifications.map((e) => ({
                      Method: <span className={`font-mono font-semibold ${e.method === 'GET' ? 'text-status-info' : e.method === 'DELETE' ? 'text-status-error' : 'text-status-success'}`}>{e.method}</span>,
                      Path: <span className="font-mono">{e.path}</span>,
                      Summary: e.summary,
                      'Status Codes': Object.entries(e.status_codes || {}).map(([code, meaning]) => `${code}: ${meaning}`).join(' · '),
                    }))}
                  />
                </AccordionItem>
              )}
              {backendCode.authentication?.strategy && (
                <AccordionItem title="Authentication" icon={Lock}>
                  <p className="text-xs text-text-primary font-medium">{backendCode.authentication.strategy}</p>
                  {backendCode.authentication.token_type && <p className="text-[11px] text-text-secondary mt-1">Token type: {backendCode.authentication.token_type}</p>}
                  {backendCode.authentication.session_handling && <p className="text-[11px] text-text-secondary">{backendCode.authentication.session_handling}</p>}
                </AccordionItem>
              )}
              {backendCode.authorization?.model && (
                <AccordionItem title="Authorization" icon={ShieldCheck}>
                  <p className="text-xs text-text-primary font-medium mb-2">{backendCode.authorization.model}</p>
                  <div className="space-y-1">
                    {Object.entries(backendCode.authorization.permission_matrix || {}).map(([role, actions]) => (
                      <p key={role} className="text-[11px] text-text-secondary"><span className="text-ey-yellow">{role}:</span> {(actions as string[]).join(', ')}</p>
                    ))}
                  </div>
                </AccordionItem>
              )}
              {!!backendCode.service_layer?.length && (
                <AccordionItem title="Service Layer" icon={Layers} badge={<span className="text-[10px] text-text-muted">{backendCode.service_layer.length}</span>}>
                  <div className="space-y-2">
                    {backendCode.service_layer.map((s, i) => (
                      <div key={i} className="rounded-lg bg-dark-bg p-3">
                        <p className="text-sm font-medium text-text-primary">{s.name}</p>
                        {s.responsibility && <p className="text-xs text-text-secondary">{s.responsibility}</p>}
                        {!!s.methods?.length && <p className="text-[10px] text-text-muted mt-1 font-mono">{s.methods.join(', ')}</p>}
                      </div>
                    ))}
                  </div>
                </AccordionItem>
              )}
              {!!backendCode.repository_layer?.length && (
                <AccordionItem title="Repository Layer" icon={Database} badge={<span className="text-[10px] text-text-muted">{backendCode.repository_layer.length}</span>}>
                  <div className="space-y-2">
                    {backendCode.repository_layer.map((r, i) => (
                      <div key={i} className="rounded-lg bg-dark-bg p-3">
                        <p className="text-sm font-medium text-text-primary">{r.name} <span className="text-[10px] text-text-muted">({r.entity})</span></p>
                        {!!r.methods?.length && <p className="text-[10px] text-text-muted mt-1 font-mono">{r.methods.join(', ')}</p>}
                      </div>
                    ))}
                  </div>
                </AccordionItem>
              )}
              {!!backendCode.validation?.length && (
                <AccordionItem title="Validation" icon={ShieldCheck}>
                  <BulletList items={backendCode.validation} />
                </AccordionItem>
              )}
              {!!backendCode.exception_handling?.length && (
                <AccordionItem title="Exception Handling" icon={AlertOctagon} badge={<span className="text-[10px] text-text-muted">{backendCode.exception_handling.length}</span>}>
                  <DataTable
                    columns={['Exception', 'HTTP Status', 'Handling Strategy']}
                    rows={backendCode.exception_handling.map((e) => ({
                      Exception: <span className="font-mono">{e.exception_type}</span>,
                      'HTTP Status': e.http_status,
                      'Handling Strategy': e.handling_strategy,
                    }))}
                  />
                </AccordionItem>
              )}
              {!!backendCode.background_jobs?.length && (
                <AccordionItem title="Background Jobs" icon={Clock3} badge={<span className="text-[10px] text-text-muted">{backendCode.background_jobs.length}</span>}>
                  <div className="space-y-2">
                    {backendCode.background_jobs.map((j, i) => (
                      <div key={i} className="rounded-lg bg-dark-bg p-3">
                        <p className="text-sm font-medium text-text-primary">{j.name}</p>
                        <p className="text-[11px] text-text-secondary">{j.purpose}</p>
                        <p className="text-[10px] text-text-muted mt-1">Trigger: {j.trigger} {j.schedule && `· ${j.schedule}`}</p>
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