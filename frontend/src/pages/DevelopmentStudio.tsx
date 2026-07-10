import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Code2,
  Folder,
  FolderTree,
  FileCode,
  Clock,
  CheckCircle2,
  Loader2,
  Terminal,
  ChevronRight,
  Monitor,
  Server,
  Shield,
  TestTube,
  Sparkles,
  AlertTriangle,
  Eye,
  CheckCircle,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar } from '../components/ui/Card';
import { apiRequest } from '../lib/api';
import { getSelectedProjectId } from '../lib/projectContext';
import { usePipelineUpdates } from '../hooks/usePipelineUpdates';
import { useUnifiedArtifacts } from '../lib/useUnifiedArtifacts';
import { LivePreviewFrame } from '../components/LivePreviewFrame';

interface FileNode {
  name: string;
  type: 'folder' | 'file';
  children?: FileNode[];
  path: string;
}

interface StreamedFile {
  path: string;
  language: string;
  lines: string[];
  complete: boolean;
  agentType: string;
}

interface AgentLogEntry {
  id: number;
  agent: string;
  action: string;
  time: string;
  status: 'running' | 'completed' | 'failed' | 'pending';
}

// Matches GET /projects/{id}/agent-runs (backend/fastapi_agents/main_extension.py)
interface AgentRunStatus {
  id: number;
  project_id: number;
  agent_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  start_time: string | null;
  end_time: string | null;
  output_url: string | null;
}

const agentColors: Record<string, string> = {
  FRONTEND: 'text-status-info',
  BACKEND: 'text-status-success',
  SECURITY: 'text-ey-yellow',
  TESTING: 'text-purple-400',
};

const bottomStatIcons: Record<string, React.ElementType> = {
  'Frontend Agent': Monitor,
  'Backend Agent': Server,
  'Security Architect Agent': Shield,
  'Testing Agent': TestTube,
};

// Generated `path` is inconsistent about whether it already includes the
// filename (e.g. "src/components/Foo.tsx") or is just the containing
// directory (e.g. "src/components", filename only in `name`) — seen in
// practice with smaller/rate-limited models. Combine defensively so two
// files in the same directory never collide under one identity.
function resolveFullPath(path: string, name: string): string {
  const cleanPath = (path || '').replace(/^\/+|\/+$/g, '');
  const cleanName = (name || '').replace(/^\/+|\/+$/g, '');
  if (!cleanName || cleanPath.endsWith(cleanName)) return cleanPath || cleanName;
  return cleanPath ? `${cleanPath}/${cleanName}` : cleanName;
}

function buildFileTree(files: { path: string }[]): FileNode {
  const root: FileNode = { name: 'root', type: 'folder', path: '', children: [] };
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let current = root;
    let accPath = '';
    parts.forEach((part, idx) => {
      // No leading slash — must match the plain "a/b/c" paths allFiles uses
      // (via resolveFullPath) so clicking a tree node's path actually finds
      // its content.
      accPath = accPath ? `${accPath}/${part}` : part;
      const isFile = idx === parts.length - 1;
      current.children = current.children || [];
      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, type: isFile ? 'file' : 'folder', path: accPath, children: isFile ? undefined : [] };
        current.children.push(child);
      }
      current = child;
    });
  }
  return root;
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

function FileTree({ node, depth = 0, selectedFile, onSelect }: { node: FileNode; depth?: number; selectedFile: string | null; onSelect: (path: string) => void }) {
  const [isOpen, setIsOpen] = useState(depth < 2);

  if (node.type === 'folder') {
    return (
      <div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1 w-full text-left text-xs py-1 hover:bg-dark-cardHover rounded px-1 transition-colors"
          style={{ paddingLeft: depth * 12 }}
        >
          <ChevronRight className={`h-3 w-3 text-text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          <Folder className="h-3 w-3 text-ey-yellow" />
          <span className="text-text-primary">{node.name}</span>
        </button>
        <AnimatePresence>
          {isOpen && node.children && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              {node.children.map((child) => (
                <FileTree
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  selectedFile={selectedFile}
                  onSelect={onSelect}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex items-center gap-1 w-full text-left text-xs py-1 hover:bg-dark-cardHover rounded px-1 transition-colors ${
        selectedFile === node.path ? 'bg-ey-yellow/10 text-ey-yellow' : ''
      }`}
      style={{ paddingLeft: (depth + 1) * 12 }}
    >
      <FileCode className="h-3 w-3 text-text-secondary" />
      <span className="text-text-secondary">{node.name}</span>
    </button>
  );
}

export function DevelopmentStudio() {
  const [projectId] = useState(() => getSelectedProjectId());
  const { getGeneratedCode, loading: artifactsLoading } = useUnifiedArtifacts(projectId);

  const [streamedFiles, setStreamedFiles] = useState<Record<string, StreamedFile>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [agentLog, setAgentLog] = useState<AgentLogEntry[]>([]);
  const [activeAgentName, setActiveAgentName] = useState<string | null>(null);
  const [runs, setRuns] = useState<AgentRunStatus[] | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const logIdRef = useRef(0);
  const sessionStartRef = useRef(Date.now());

  const loadPipelineStatus = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await apiRequest<AgentRunStatus[]>(`/projects/${projectId}/agent-runs`);
      setRuns(data);
    } catch {
      setRuns(null);
    }
  }, [projectId]);

  useEffect(() => { loadPipelineStatus(); }, [loadPipelineStatus]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - sessionStartRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const handleEvent = useCallback((event: { type: string; data: Record<string, unknown> }) => {
    const nowStr = new Date().toLocaleTimeString();
    const pushLog = (entry: Omit<AgentLogEntry, 'id'>) => {
      logIdRef.current += 1;
      setAgentLog((prev) => [{ id: logIdRef.current, ...entry }, ...prev].slice(0, 60));
    };

    // Real backend payload field names are snake_case
    // (backend/fastapi_agents/ws_manager.py / agent_runner.py) — e.g.
    // {"agent_name": "Frontend Agent", "run_id": 12} for agent_started.
    switch (event.type) {
      case 'agent_started': {
        const agentName = String(event.data.agent_name || 'Agent');
        setActiveAgentName(agentName);
        pushLog({ agent: agentName, action: 'Started', time: nowStr, status: 'running' });
        break;
      }
      case 'agent_completed': {
        const agentName = String(event.data.agent_name || 'Agent');
        const status = String(event.data.status || 'completed');
        setActiveAgentName((cur) => (cur === agentName ? null : cur));
        pushLog({ agent: agentName, action: status === 'failed' ? 'Failed' : 'Completed', time: nowStr, status: status === 'failed' ? 'failed' : 'completed' });
        loadPipelineStatus();
        break;
      }
      case 'code_gen_started': {
        pushLog({ agent: String(event.data.agent_type || '').toUpperCase(), action: `Generating ${event.data.total_files ?? 0} file(s)`, time: nowStr, status: 'running' });
        break;
      }
      case 'code_chunk': {
        const path = String(event.data.file_path || '');
        const language = String(event.data.language || 'text');
        const agentType = String(event.data.agent_type || '');
        const chunk = String(event.data.chunk ?? '');
        const isFirst = Boolean(event.data.is_first_chunk);
        const isLast = Boolean(event.data.is_last_chunk);
        if (!path) break;

        setSelectedFile((cur) => cur ?? path);
        setStreamedFiles((prev) => {
          const previousLines = isFirst || !prev[path] ? [] : prev[path].lines;
          return {
            ...prev,
            [path]: { path, language, agentType, complete: isLast, lines: [...previousLines, ...chunk.split('\n')] },
          };
        });

        if (isLast) {
          pushLog({ agent: agentType.toUpperCase(), action: `Completed ${path.split('/').pop()}`, time: nowStr, status: 'completed' });
        }
        break;
      }
      case 'code_gen_completed': {
        pushLog({
          agent: String(event.data.agent_type || '').toUpperCase(),
          action: `Generated ${event.data.file_count ?? 0} file(s), ${event.data.lines_of_code ?? 0} lines`,
          time: nowStr,
          status: 'completed',
        });
        break;
      }
      default:
        break;
    }
  }, [loadPipelineStatus]);

  usePipelineUpdates(projectId, handleEvent);

  const frontendCode = getGeneratedCode('frontend');
  const backendCode = getGeneratedCode('backend');

  const allFiles = useMemo(() => {
    const map = new Map<string, { path: string; language: string; content?: string }>();
    (frontendCode?.files || []).forEach((f) => { const p = resolveFullPath(f.path, f.name); map.set(p, { path: p, language: f.language, content: f.content }); });
    (backendCode?.files || []).forEach((f) => { const p = resolveFullPath(f.path, f.name); map.set(p, { path: p, language: f.language, content: f.content }); });
    Object.values(streamedFiles).forEach((f) => map.set(f.path, { path: f.path, language: f.language }));
    return Array.from(map.values());
  }, [frontendCode, backendCode, streamedFiles]);

  const fileTree = useMemo(() => buildFileTree(allFiles), [allFiles]);

  const selectedStreamed = selectedFile ? streamedFiles[selectedFile] : undefined;
  const selectedStatic = selectedFile ? allFiles.find((f) => f.path === selectedFile) : undefined;
  const selectedContent = selectedStreamed ? selectedStreamed.lines.join('\n') : selectedStatic?.content || '';
  const selectedLanguage = selectedStreamed?.language || selectedStatic?.language || '';
  const selectedAgentType = selectedStreamed?.agentType
    || (frontendCode?.files?.some((f) => resolveFullPath(f.path, f.name) === selectedFile) ? 'frontend' : backendCode?.files?.some((f) => resolveFullPath(f.path, f.name) === selectedFile) ? 'backend' : '');

  const totalLines = useMemo(() => {
    let sum = 0;
    const counted = new Set<string>();
    Object.values(streamedFiles).forEach((f) => { sum += f.lines.length; counted.add(f.path); });
    (frontendCode?.files || []).forEach((f) => { if (!counted.has(resolveFullPath(f.path, f.name))) sum += (f.content || '').split('\n').length; });
    (backendCode?.files || []).forEach((f) => { if (!counted.has(resolveFullPath(f.path, f.name))) sum += (f.content || '').split('\n').length; });
    return sum;
  }, [streamedFiles, frontendCode, backendCode]);

  const bottomStages = (runs || []).filter((r) => Object.prototype.hasOwnProperty.call(bottomStatIcons, r.agent_name));
  const completedCount = (runs || []).filter((r) => r.status === 'completed').length;
  const totalStages = runs?.length || 0;
  const percentage = totalStages > 0 ? Math.round((completedCount / totalStages) * 100) : 0;
  const hasFailedRun = (runs || []).some((r) => r.status === 'failed');
  const workflowStatus = hasFailedRun ? 'failed' : totalStages > 0 && completedCount === totalStages ? 'completed' : 'running';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Development Studio</h1>
          <p className="mt-1 text-sm text-text-muted">Unified build monitor — live code generation across Frontend and Backend agents</p>
        </div>
        <div className="flex items-center gap-4">
          {activeAgentName && (
            <div className="flex items-center gap-2 rounded-lg bg-status-info/10 px-3 py-1.5">
              <Loader2 className="h-4 w-4 text-status-info animate-spin" />
              <span className="text-xs text-status-info">{activeAgentName}</span>
            </div>
          )}
          <div className="flex items-center gap-2 rounded-lg border border-dark-border px-3 py-1.5">
            <Clock className="h-4 w-4 text-text-muted" />
            <span className="text-xs text-text-muted">Runtime: {formatElapsed(elapsedSeconds)}</span>
          </div>
        </div>
      </div>

      {!projectId ? (
        <Card className="py-10 text-center">
          <AlertTriangle className="h-10 w-10 text-dark-border-light mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">No project selected</p>
          <p className="text-xs text-text-muted mt-1">Select a project in the Dashboard to view the build monitor.</p>
        </Card>
      ) : (
        <>
          {/* Progress Bar */}
          <Card className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-muted">Overall Progress</span>
                <span className="text-xs text-text-primary">{percentage}%</span>
              </div>
              <ProgressBar value={percentage} color="yellow" />
            </div>
            <div className="flex items-center gap-4 border-l border-dark-border pl-4">
              <div className="text-center">
                <p className="text-lg font-semibold text-ey-yellow">{allFiles.length}</p>
                <p className="text-[10px] text-text-muted">Files</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-text-primary">{totalLines.toLocaleString()}</p>
                <p className="text-[10px] text-text-muted">Lines</p>
              </div>
              <div className="text-center">
                <StatusBadge status={workflowStatus === 'failed' ? 'error' : workflowStatus === 'completed' ? 'success' : 'running'}>
                  {totalStages > 0 ? workflowStatus : (artifactsLoading ? 'Loading' : 'Idle')}
                </StatusBadge>
              </div>
            </div>
          </Card>

          {/* Three Column Layout */}
          <div className="grid gap-4 lg:grid-cols-4">
            {/* Column 1: Project Structure */}
            <Card className="lg:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <FolderTree className="h-4 w-4 text-ey-yellow" />
                <h3 className="section-title mb-0">Project Structure</h3>
              </div>
              <div className="max-h-[500px] overflow-y-auto">
                {fileTree.children && fileTree.children.length > 0 ? (
                  <div className="space-y-0.5">
                    {fileTree.children.map((child) => (
                      <FileTree key={child.path} node={child} depth={0} selectedFile={selectedFile} onSelect={setSelectedFile} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-text-muted py-4 text-center">No files generated yet. Run the Frontend/Backend agents to see the project tree here.</p>
                )}
              </div>
              <div className="mt-4 pt-4 border-t border-dark-border">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">Total Files</span>
                  <span className="text-text-primary">{allFiles.length}</span>
                </div>
              </div>
            </Card>

            {/* Column 2: Live Code Stream */}
            <Card className="lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Code2 className="h-4 w-4 text-ey-yellow" />
                  <h3 className="section-title mb-0">Live Code Stream</h3>
                </div>
              </div>
              <div className="h-[450px] overflow-hidden rounded-lg border border-dark-border bg-dark-bg">
                <div className="flex items-center justify-between border-b border-dark-border bg-dark-card px-3 py-2">
                  <div className="flex items-center gap-2">
                    <FileCode className="h-3 w-3 text-text-muted" />
                    <span className="text-xs text-text-primary">{selectedFile ? selectedFile.split('/').pop() : 'No file selected'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-muted">{selectedLanguage || '—'}</span>
                    <StatusBadge status={selectedStreamed && !selectedStreamed.complete ? 'running' : 'success'}>
                      <Sparkles className="mr-1 h-2 w-2" />
                      {selectedStreamed && !selectedStreamed.complete ? 'Generating' : 'Generated'}
                    </StatusBadge>
                  </div>
                </div>
                <div className="font-mono text-xs p-4 overflow-auto h-[calc(100%-36px)]">
                  {selectedContent ? (
                    <pre className="text-text-secondary">
                      {selectedContent.split('\n').map((line, index) => (
                        <motion.div
                          key={`${selectedFile}-${index}`}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: Math.min(index * 0.01, 0.6) }}
                          className="flex"
                        >
                          <span className="w-8 text-right pr-4 text-dark-border-light select-none">{index + 1}</span>
                          <span className={
                            line.includes('import') ? 'text-status-info' :
                            line.includes('const') || line.includes('function') || line.includes('def ') || line.includes('class ') ? 'text-ey-yellow' :
                            line.includes('return') ? 'text-status-success' :
                            'text-text-secondary'
                          }>
                            {line}
                          </span>
                        </motion.div>
                      ))}
                    </pre>
                  ) : (
                    <p className="text-text-muted">Waiting for code generation — select a file once one appears in Project Structure.</p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-text-muted">
                <span>{selectedAgentType ? `Generated by ${selectedAgentType === 'frontend' ? 'Frontend Agent' : 'Backend Agent'}` : ''}</span>
                <span>{selectedContent ? `${selectedContent.split('\n').length} lines` : ''}{selectedLanguage ? ` | ${selectedLanguage}` : ''}</span>
              </div>
            </Card>

            {/* Column 3: Structured Agent Log */}
            <Card className="lg:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <Terminal className="h-4 w-4 text-ey-yellow" />
                <h3 className="section-title mb-0">Agent Log</h3>
              </div>
              <div className="space-y-2 max-h-[450px] overflow-y-auto">
                {agentLog.length === 0 ? (
                  <p className="text-xs text-text-muted py-4 text-center">No activity yet.</p>
                ) : (
                  agentLog.map((log) => (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`rounded-lg p-2 ${
                        log.status === 'running' ? 'bg-status-info/5 border border-status-info/20' :
                        log.status === 'failed' ? 'bg-status-error/5 border border-status-error/20' :
                        log.status === 'completed' ? 'bg-dark-bg' :
                        'bg-dark-bg opacity-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-medium ${agentColors[log.agent] || 'text-text-secondary'}`}>
                          {log.agent}
                        </span>
                        <span className="text-[10px] text-text-muted">{log.time}</span>
                      </div>
                      <p className="text-xs text-text-primary mt-1">{log.action}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {log.status === 'running' && <Loader2 className="h-3 w-3 text-status-info animate-spin" />}
                        {log.status === 'completed' && <CheckCircle2 className="h-3 w-3 text-status-success" />}
                        {log.status === 'failed' && <AlertTriangle className="h-3 w-3 text-status-error" />}
                        {log.status === 'pending' && <Clock className="h-3 w-3 text-text-muted" />}
                      </div>
                    </motion.div>
                  ))
                )}
              </div>

              {/* Runtime — the backend doesn't track tokens/cost per run,
                  so this only shows what's actually knowable. */}
              <div className="mt-4 pt-4 border-t border-dark-border">
                <p className="text-xs text-text-muted mb-2">Runtime</p>
                <p className="text-sm text-text-primary">{formatElapsed(elapsedSeconds)}</p>
              </div>
            </Card>
          </div>

          {/* Preview — appears once both Frontend and Backend have produced files.
              Frontend: real in-browser compiled preview (see LivePreviewFrame).
              Backend: a validated status card — no server is actually spawned. */}
          {(frontendCode?.files?.length || 0) > 0 && (backendCode?.files?.length || 0) > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <Eye className="h-4 w-4 text-ey-yellow" />
                  <h3 className="section-title mb-0">Frontend Preview</h3>
                </div>
                <LivePreviewFrame files={frontendCode?.files || []} />
              </Card>
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <Server className="h-4 w-4 text-ey-yellow" />
                  <h3 className="section-title mb-0">Backend Status</h3>
                </div>
                <div className="rounded-lg border border-dark-border bg-dark-bg p-4 h-[360px] overflow-y-auto">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle className="h-4 w-4 text-status-success" />
                    <span className="text-sm text-text-primary">{backendCode?.framework || 'Backend'} — Validated</span>
                  </div>
                  <p className="text-xs text-text-muted mb-3">
                    Generated code structure verified. No server process is spawned automatically — start it locally to run it live.
                  </p>
                  {(backendCode?.api_specifications?.length || 0) > 0 ? (
                    <div className="space-y-1.5">
                      {(backendCode?.api_specifications || []).map((endpoint, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs rounded bg-dark-card px-2 py-1.5">
                          <span className="font-mono text-ey-yellow w-14 flex-shrink-0">{endpoint.method}</span>
                          <span className="text-text-secondary truncate">{endpoint.path}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-text-muted">{(backendCode?.files?.length || 0)} file(s) generated.</p>
                  )}
                </div>
              </Card>
            </div>
          )}

          {/* Bottom Stats — pipeline stages most relevant to this build */}
          {bottomStages.length > 0 && (
            <div className="grid gap-4 md:grid-cols-4">
              {bottomStages.map((run) => {
                const Icon = bottomStatIcons[run.agent_name] || Code2;
                return (
                  <Card key={run.id} className="text-center">
                    <div className={`mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${
                      run.status === 'running' ? 'bg-status-info/10' :
                      run.status === 'completed' ? 'bg-status-success/10' :
                      run.status === 'failed' ? 'bg-status-error/10' :
                      'bg-dark-bg'
                    }`}>
                      <Icon className={`h-4 w-4 ${
                        run.status === 'running' ? 'text-status-info animate-pulse' :
                        run.status === 'completed' ? 'text-status-success' :
                        run.status === 'failed' ? 'text-status-error' :
                        'text-text-muted'
                      }`} />
                    </div>
                    <p className="text-xs font-medium text-text-primary">{run.agent_name}</p>
                    <StatusBadge status={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'error' : run.status === 'running' ? 'running' : 'pending'} className="mt-2">
                      {run.status}
                    </StatusBadge>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
