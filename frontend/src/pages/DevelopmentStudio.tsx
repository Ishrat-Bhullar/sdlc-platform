import { useState, useEffect } from 'react';
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
  ChevronDown,
  Monitor,
  Server,
  Shield,
  TestTube,
  Sparkles,
  RefreshCw,
  Play,
  Pause,
  Eye,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar, PreviewBadge } from '../components/ui/Card';
import { mockGeneratedFiles, mockAgents } from '../data/mockData';

interface FileNode {
  name: string;
  type: 'folder' | 'file';
  children?: FileNode[];
  path: string;
}

const projectStructure: FileNode = {
  name: 'src',
  type: 'folder',
  path: '/src',
  children: [
    {
      name: 'components',
      type: 'folder',
      path: '/src/components',
      children: [
        { name: 'auth', type: 'folder', path: '/src/components/auth', children: [
          { name: 'LoginForm.tsx', type: 'file', path: '/src/components/auth/LoginForm.tsx' },
          { name: 'RegisterForm.tsx', type: 'file', path: '/src/components/auth/RegisterForm.tsx' },
          { name: 'MFASetup.tsx', type: 'file', path: '/src/components/auth/MFASetup.tsx' },
        ]},
        { name: 'dashboard', type: 'folder', path: '/src/components/dashboard', children: [
          { name: 'AccountOverview.tsx', type: 'file', path: '/src/components/dashboard/AccountOverview.tsx' },
          { name: 'TransactionList.tsx', type: 'file', path: '/src/components/dashboard/TransactionList.tsx' },
        ]},
        { name: 'common', type: 'folder', path: '/src/components/common', children: [
          { name: 'Button.tsx', type: 'file', path: '/src/components/common/Button.tsx' },
          { name: 'Modal.tsx', type: 'file', path: '/src/components/common/Modal.tsx' },
        ]},
      ],
    },
    {
      name: 'pages',
      type: 'folder',
      path: '/src/pages',
      children: [
        { name: 'Dashboard.tsx', type: 'file', path: '/src/pages/Dashboard.tsx' },
        { name: 'Accounts.tsx', type: 'file', path: '/src/pages/Accounts.tsx' },
        { name: 'Transfer.tsx', type: 'file', path: '/src/pages/Transfer.tsx' },
      ],
    },
    {
      name: 'services',
      type: 'folder',
      path: '/src/services',
      children: [
        { name: 'auth.service.ts', type: 'file', path: '/src/services/auth.service.ts' },
        { name: 'account.service.ts', type: 'file', path: '/src/services/account.service.ts' },
        { name: 'transaction.service.ts', type: 'file', path: '/src/services/transaction.service.ts' },
      ],
    },
    {
      name: 'api',
      type: 'folder',
      path: '/src/api',
      children: [
        { name: 'client.ts', type: 'file', path: '/src/api/client.ts' },
        { name: 'endpoints.ts', type: 'file', path: '/src/api/endpoints.ts' },
      ],
    },
    {
      name: 'database',
      type: 'folder',
      path: '/src/database',
      children: [
        { name: 'models.ts', type: 'file', path: '/src/database/models.ts' },
        { name: 'migrations.ts', type: 'file', path: '/src/database/migrations.ts' },
      ],
    },
    {
      name: 'tests',
      type: 'folder',
      path: '/src/tests',
      children: [
        { name: 'auth.test.ts', type: 'file', path: '/src/tests/auth.test.ts' },
        { name: 'account.test.ts', type: 'file', path: '/src/tests/account.test.ts' },
      ],
    },
  ],
};

const agentLogs = [
  { id: 1, agent: 'FRONTEND_AGENT', action: 'Generating LoginForm.tsx', time: '10:34:12', status: 'running' },
  { id: 2, agent: 'FRONTEND_AGENT', action: 'Completed MFASetup.tsx', time: '10:32:45', status: 'completed' },
  { id: 3, agent: 'BACKEND_AGENT', action: 'Creating REST API endpoints', time: '10:30:18', status: 'running' },
  { id: 4, agent: 'SECURITY_AGENT', action: 'Running AST Analysis', time: '10:28:33', status: 'running' },
  { id: 5, agent: 'TESTING_AGENT', action: 'Generating unit tests', time: '10:25:01', status: 'pending' },
  { id: 6, agent: 'FRONTEND_AGENT', action: 'Completed RegisterForm.tsx', time: '10:22:15', status: 'completed' },
  { id: 7, agent: 'BACKEND_AGENT', action: 'Completed auth.service.ts', time: '10:18:42', status: 'completed' },
];

const agentColors: Record<string, string> = {
  'FRONTEND_AGENT': 'text-status-info',
  'BACKEND_AGENT': 'text-status-success',
  'SECURITY_AGENT': 'text-ey-yellow',
  'TESTING_AGENT': 'text-purple-400',
};

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
  const [selectedFile, setSelectedFile] = useState<string | null>('/src/components/auth/LoginForm.tsx');
  const [isPlaying, setIsPlaying] = useState(true);
  const [linesOfCode, setLinesOfCode] = useState(12453);

  const activeAgent = mockAgents.find((a) => a.status === 'running');
  const totalGenerated = mockGeneratedFiles.length;

  // Simulate code generation
  useEffect(() => {
    if (isPlaying && activeAgent) {
      const interval = setInterval(() => {
        setLinesOfCode((prev) => prev + Math.floor(Math.random() * 10));
      }, 500);
      return () => clearInterval(interval);
    }
  }, [isPlaying, activeAgent]);

  const sampleCode = `import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { FaSpinner } from 'react-icons/fa';

interface LoginFormProps {
  onSuccess?: () => void;
  onRegister?: () => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onSuccess, onRegister }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      await login(email, password);
      onSuccess?.();
    } catch (err) {
      setError('Invalid credentials');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      {/* Generated by Frontend Agent */}
    </form>
  );
};`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-primary">Development Studio</h1>
            <PreviewBadge />
          </div>
          <p className="mt-1 text-sm text-text-muted">Real-time code generation workspace — showcasing planned functionality with sample data</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Current Agent */}
          {activeAgent && (
            <div className="flex items-center gap-2 rounded-lg bg-status-info/10 px-3 py-1.5">
              <Loader2 className="h-4 w-4 text-status-info animate-spin" />
              <span className="text-xs text-status-info">{activeAgent.name}</span>
            </div>
          )}
          <div className="flex items-center gap-2 rounded-lg border border-dark-border px-3 py-1.5">
            <Clock className="h-4 w-4 text-text-muted" />
            <span className="text-xs text-text-muted">Runtime: 1h 23m</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`btn-ghost text-xs ${isPlaying ? 'text-ey-yellow' : ''}`}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button className="btn-secondary text-sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              Sync
            </button>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <Card className="flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-muted">Overall Progress</span>
            <span className="text-xs text-text-primary">34%</span>
          </div>
          <ProgressBar value={34} color="yellow" />
        </div>
        <div className="flex items-center gap-4 border-l border-dark-border pl-4">
          <div className="text-center">
            <p className="text-lg font-semibold text-ey-yellow">{totalGenerated}</p>
            <p className="text-[10px] text-text-muted">Files</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-text-primary">{linesOfCode.toLocaleString()}</p>
            <p className="text-[10px] text-text-muted">Lines</p>
          </div>
          <div className="text-center">
            <StatusBadge status="success">Building</StatusBadge>
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
            <div className="space-y-0.5">
              <button className="flex items-center gap-1 w-full text-left text-xs py-1">
                <ChevronDown className="h-3 w-3 text-text-muted" />
                <Folder className="h-3 w-3 text-ey-yellow" />
                <span className="text-text-primary font-medium">src</span>
              </button>
              <div className="pl-4">
                {projectStructure.children?.map((child) => (
                  <FileTree
                    key={child.path}
                    node={child}
                    depth={0}
                    selectedFile={selectedFile}
                    onSelect={setSelectedFile}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-dark-border">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">Total Files</span>
              <span className="text-text-primary">{mockGeneratedFiles.length * 3}</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-text-muted">Last Generated</span>
              <span className="text-text-primary">5 min ago</span>
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
            <div className="flex items-center gap-2">
              <button className="btn-ghost text-xs">
                <Eye className="mr-1 h-3 w-3" />
                Preview
              </button>
              <button className="btn-ghost text-xs">
                <FileCode className="mr-1 h-3 w-3" />
                Diff
              </button>
            </div>
          </div>
          <div className="h-[450px] overflow-hidden rounded-lg border border-dark-border bg-dark-bg">
            <div className="flex items-center justify-between border-b border-dark-border bg-dark-card px-3 py-2">
              <div className="flex items-center gap-2">
                <FileCode className="h-3 w-3 text-text-muted" />
                <span className="text-xs text-text-primary">{selectedFile?.split('/').pop()}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-muted">TypeScript React</span>
                <StatusBadge status="success">
                  <Sparkles className="mr-1 h-2 w-2" />
                  Generated
                </StatusBadge>
              </div>
            </div>
            <div className="font-mono text-xs p-4 overflow-auto h-[calc(100%-36px)]">
              <pre className="text-text-secondary">
                {sampleCode.split('\n').map((line, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className="flex"
                  >
                    <span className="w-8 text-right pr-4 text-dark-border-light select-none">
                      {index + 1}
                    </span>
                    <span className={
                      line.includes('import') ? 'text-status-info' :
                      line.includes('const') || line.includes('function') ? 'text-ey-yellow' :
                      line.includes('return') ? 'text-status-success' :
                      'text-text-secondary'
                    }>
                      {line}
                    </span>
                  </motion.div>
                ))}
              </pre>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-text-muted">
            <span>Generated by Frontend Agent</span>
            <span>145 lines | TypeScript</span>
          </div>
        </Card>

        {/* Column 3: Structured Agent Log */}
        <Card className="lg:col-span-1">
          <div className="flex items-center gap-2 mb-4">
            <Terminal className="h-4 w-4 text-ey-yellow" />
            <h3 className="section-title mb-0">Agent Log</h3>
          </div>
          <div className="space-y-2 max-h-[450px] overflow-y-auto">
            {agentLogs.map((log) => (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={`rounded-lg p-2 ${
                  log.status === 'running' ? 'bg-status-info/5 border border-status-info/20' :
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
                  {log.status === 'running' && (
                    <Loader2 className="h-3 w-3 text-status-info animate-spin" />
                  )}
                  {log.status === 'completed' && (
                    <CheckCircle2 className="h-3 w-3 text-status-success" />
                  )}
                  {log.status === 'pending' && (
                    <Clock className="h-3 w-3 text-text-muted" />
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          {/* Resources */}
          <div className="mt-4 pt-4 border-t border-dark-border">
            <p className="text-xs text-text-muted mb-2">Token Usage</p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-primary">834K</span>
              <ProgressBar value={83} max={100} color="blue" className="w-24" />
            </div>
            <p className="text-xs text-text-muted mt-3 mb-2">Runtime</p>
            <p className="text-sm text-text-primary">1h 23m 45s</p>
          </div>
        </Card>
      </div>

      {/* Bottom Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        {mockAgents.filter((a) => a.status !== 'idle').map((agent) => {
          const icons: Record<string, React.ElementType> = {
            'frontend': Monitor,
            'backend': Server,
            'security': Shield,
            'testing': TestTube,
          };
          const Icon = icons[agent.type] || Code2;
          return (
            <Card key={agent.id} className="text-center">
              <div className={`mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${
                agent.status === 'running' ? 'bg-status-info/10' :
                agent.status === 'completed' ? 'bg-status-success/10' :
                'bg-dark-bg'
              }`}>
                <Icon className={`h-4 w-4 ${
                  agent.status === 'running' ? 'text-status-info animate-pulse' :
                  agent.status === 'completed' ? 'text-status-success' :
                  'text-text-muted'
                }`} />
              </div>
              <p className="text-xs font-medium text-text-primary">{agent.name}</p>
              <StatusBadge status={agent.status} className="mt-2">
                {agent.status}
              </StatusBadge>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
