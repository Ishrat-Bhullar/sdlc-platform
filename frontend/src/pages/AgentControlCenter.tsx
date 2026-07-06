import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Activity,
  Clock,
  Zap,
  DollarSign,
  Play,
  Pause,
  RefreshCw,
  Settings,
  ChevronRight,
  CheckCircle2,
  FileSearch,
  Briefcase,
  Building2,
  Database,
  Monitor,
  Server,
  TestTube,
  Shield,
  Rocket,
  FileText,
  X,
  History,
  Package,
  Code,
  Brain,
  BookOpen,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar, PreviewBadge } from '../components/ui/Card';
import { mockAgents } from '../data/mockData';
import type { Agent } from '../types';

const workflowSequence = [
  { name: 'Requirements', type: 'requirement', icon: FileSearch },
  { name: 'Business Analyst', type: 'business-analyst', icon: Briefcase },
  { name: 'Architect', type: 'architect', icon: Building2 },
  { name: 'Database', type: 'database', icon: Database },
  { name: 'Frontend', type: 'frontend', icon: Monitor },
  { name: 'Backend', type: 'backend', icon: Server },
  { name: 'Code Review', type: 'code-review', icon: Code },
  { name: 'Testing', type: 'testing', icon: TestTube },
  { name: 'Security', type: 'security', icon: Shield },
  { name: 'Documentation', type: 'documentation', icon: FileText },
  { name: 'DevOps', type: 'devops', icon: Rocket },
  { name: 'Deployment', type: 'deployment', icon: Rocket },
];

const agentIcons: Record<string, React.ElementType> = {
  'requirement': FileSearch,
  'business-analyst': Briefcase,
  'architect': Building2,
  'database': Database,
  'frontend': Monitor,
  'backend': Server,
  'code-review': Code,
  'testing': TestTube,
  'security': Shield,
  'documentation': FileText,
  'devops': Rocket,
  'memory': Brain,
  'knowledge': BookOpen,
};

export function AgentControlCenter() {
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  const activeAgents = mockAgents.filter((a) => a.status === 'running');
  const waitingAgents = mockAgents.filter((a) => a.status === 'waiting');

  const totalTokens = mockAgents.reduce((sum, a) => sum + a.tokens, 0);
  const totalCost = mockAgents.reduce((sum, a) => sum + a.cost, 0);

  const executionHistory = [
    { id: 1, agent: 'Requirement Agent', action: 'Completed BRD analysis', time: '10:45', result: 'success' },
    { id: 2, agent: 'Business Analyst Agent', action: 'Generated 124 user stories', time: '10:30', result: 'success' },
    { id: 3, agent: 'Architect Agent', action: 'Started microservices design', time: '10:15', result: 'running' },
    { id: 4, agent: 'Database Agent', action: 'Schema generation queued', time: '10:00', result: 'waiting' },
    { id: 5, agent: 'Frontend Agent', action: 'Waiting for architecture approval', time: '09:45', result: 'waiting' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-primary">Agent Control Center</h1>
            <PreviewBadge />
          </div>
          <p className="mt-1 text-sm text-text-muted">Manage and monitor all AI agents — showcasing planned functionality with sample data</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-ghost text-sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Status
          </button>
          <button className="btn-secondary text-sm">
            <Settings className="mr-2 h-4 w-4" />
            Configure Fleet
          </button>
        </div>
      </div>

      {/* Top Metrics */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card className="text-center">
          <Bot className="h-6 w-6 text-ey-yellow mx-auto mb-2" />
          <p className="text-2xl font-bold text-text-primary">{mockAgents.length}</p>
          <p className="text-xs text-text-muted">Total Agents</p>
        </Card>
        <Card className="text-center">
          <Activity className="h-6 w-6 text-status-info mx-auto mb-2" />
          <p className="text-2xl font-bold text-status-info">{activeAgents.length}</p>
          <p className="text-xs text-text-muted">Running</p>
        </Card>
        <Card className="text-center">
          <Clock className="h-6 w-6 text-status-warning mx-auto mb-2" />
          <p className="text-2xl font-bold text-status-warning">{waitingAgents.length}</p>
          <p className="text-xs text-text-muted">Waiting</p>
        </Card>
        <Card className="text-center">
          <Zap className="h-6 w-6 text-status-success mx-auto mb-2" />
          <p className="text-2xl font-bold text-status-success">{totalTokens.toLocaleString()}</p>
          <p className="text-xs text-text-muted">Tokens Used</p>
        </Card>
        <Card className="text-center">
          <DollarSign className="h-6 w-6 text-ey-yellow mx-auto mb-2" />
          <p className="text-2xl font-bold text-ey-yellow">${totalCost.toFixed(2)}</p>
          <p className="text-xs text-text-muted">Total Cost</p>
        </Card>
      </div>

      {/* Agent Fleet Table */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title mb-0">Agent Fleet</h3>
          <div className="flex items-center gap-2">
            <button className="btn-ghost text-xs">
              <Play className="mr-1 h-3 w-3" />
              Start All
            </button>
            <button className="btn-ghost text-xs">
              <Pause className="mr-1 h-3 w-3" />
              Pause All
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-dark-border">
                <th className="text-left text-xs font-medium text-text-muted pb-3">Agent</th>
                <th className="text-left text-xs font-medium text-text-muted pb-3">Status</th>
                <th className="text-left text-xs font-medium text-text-muted pb-3">Task</th>
                <th className="text-left text-xs font-medium text-text-muted pb-3">Progress</th>
                <th className="text-left text-xs font-medium text-text-muted pb-3">Runtime</th>
                <th className="text-left text-xs font-medium text-text-muted pb-3">Tokens</th>
                <th className="text-left text-xs font-medium text-text-muted pb-3">Cost</th>
                <th className="text-left text-xs font-medium text-text-muted pb-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {mockAgents.map((agent) => {
                const Icon = agentIcons[agent.type] || Bot;
                return (
                  <tr
                    key={agent.id}
                    className="border-b border-dark-border/50 hover:bg-dark-cardHover cursor-pointer transition-colors"
                    onClick={() => setSelectedAgent(agent)}
                  >
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                          agent.status === 'running' ? 'bg-status-info/10' :
                          agent.status === 'completed' ? 'bg-status-success/10' :
                          agent.status === 'waiting' ? 'bg-status-warning/10' :
                          'bg-dark-bg'
                        }`}>
                          <Icon className={`h-4 w-4 ${
                            agent.status === 'running' ? 'text-status-info' :
                            agent.status === 'completed' ? 'text-status-success' :
                            agent.status === 'waiting' ? 'text-status-warning' :
                            'text-text-muted'
                          }`} />
                        </div>
                        <span className="text-sm font-medium text-text-primary">{agent.name}</span>
                      </div>
                    </td>
                    <td className="py-3">
                      <StatusBadge status={
                        agent.status === 'running' ? 'running' :
                        agent.status === 'completed' ? 'success' :
                        agent.status === 'waiting' ? 'pending' :
                        agent.status === 'failed' ? 'error' : 'idle'
                      }>
                        {agent.status}
                      </StatusBadge>
                    </td>
                    <td className="py-3">
                      <span className="text-xs text-text-secondary">
                        {agent.currentTask || 'Idle'}
                      </span>
                    </td>
                    <td className="py-3">
                      <div className="w-24">
                        <ProgressBar
                          value={agent.progress}
                          max={100}
                          color={agent.status === 'running' ? 'yellow' : agent.status === 'completed' ? 'green' : 'gray'}
                        />
                      </div>
                    </td>
                    <td className="py-3">
                      <span className="text-xs text-text-secondary">
                        {agent.runtime > 0 ? `${Math.floor(agent.runtime / 60)}m ${agent.runtime % 60}s` : '-'}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="text-xs text-text-secondary">
                        {agent.tokens > 0 ? agent.tokens.toLocaleString() : '-'}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="text-xs text-text-secondary">
                        {agent.cost > 0 ? `$${agent.cost.toFixed(2)}` : '-'}
                      </span>
                    </td>
                    <td className="py-3">
                      <button className="btn-ghost text-xs" onClick={(e) => { e.stopPropagation(); }}>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Workflow Graph & Execution History */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Multi-Agent Workflow Graph */}
        <Card>
          <h3 className="section-title">Workflow Graph</h3>
          <p className="text-xs text-text-muted mb-3">Agent execution sequence across the SDLC pipeline</p>
          <div className="relative py-4">
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <defs>
                <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#FFE600" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#FFE600" stopOpacity="0.8" />
                </linearGradient>
              </defs>
            </svg>
            <div className="flex items-center justify-between flex-wrap gap-y-3">
              {workflowSequence.map((node, index) => {
                const Icon = node.icon || Bot;
                const agent = mockAgents.find((a) => a.type === node.type);
                const status = agent?.status || 'idle';
                return (
                  <div key={node.name} className="flex items-center">
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.05 }}
                      className={`flex flex-col items-center p-2 rounded-lg ${
                        status === 'running' ? 'bg-ey-yellow/10 border border-ey-yellow/30' :
                        status === 'completed' ? 'bg-status-success/10 border border-status-success/30' :
                        status === 'waiting' ? 'bg-status-warning/10 border border-status-warning/30' :
                        'bg-dark-bg border border-dark-border'
                      }`}
                    >
                      <Icon className={`h-5 w-5 mb-1 ${
                        status === 'running' ? 'text-ey-yellow animate-pulse' :
                        status === 'completed' ? 'text-status-success' :
                        status === 'waiting' ? 'text-status-warning' :
                        'text-text-muted'
                      }`} />
                      <span className="text-[10px] text-text-secondary whitespace-nowrap">{node.name}</span>
                    </motion.div>
                    {index < workflowSequence.length - 1 && (
                      <ChevronRight className={`h-4 w-4 mx-0.5 flex-shrink-0 ${
                        status === 'completed' ? 'text-status-success' :
                        status === 'running' ? 'text-ey-yellow' :
                        'text-dark-border-light'
                      }`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        {/* Execution History */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title mb-0">Execution History</h3>
            <button className="btn-ghost text-xs">
              <History className="mr-1 h-3 w-3" />
              View All
            </button>
          </div>
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {executionHistory.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded-lg bg-dark-bg p-2">
                <div className={`h-2 w-2 rounded-full ${
                  item.result === 'success' ? 'bg-status-success' :
                  item.result === 'running' ? 'bg-status-info animate-pulse' :
                  'bg-text-muted'
                }`} />
                <div className="flex-1">
                  <p className="text-xs font-medium text-text-primary">{item.agent}</p>
                  <p className="text-[10px] text-text-muted">{item.action}</p>
                </div>
                <span className="text-[10px] text-text-muted">{item.time}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Agent Detail Modal */}
      <AnimatePresence>
        {selectedAgent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-dark-bg/80 backdrop-blur-sm"
            onClick={() => setSelectedAgent(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-dark-card border border-dark-border rounded-lg w-full max-w-2xl max-h-[80vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-dark-border p-4">
                <div className="flex items-center gap-3">
                  {(() => {
                    const Icon = agentIcons[selectedAgent.type] || Bot;
                    return (
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                        selectedAgent.status === 'running' ? 'bg-status-info/10' :
                        selectedAgent.status === 'completed' ? 'bg-status-success/10' :
                        'bg-dark-bg'
                      }`}>
                        <Icon className={`h-5 w-5 ${
                          selectedAgent.status === 'running' ? 'text-status-info' :
                          selectedAgent.status === 'completed' ? 'text-status-success' :
                          'text-text-muted'
                        }`} />
                      </div>
                    );
                  })()}
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary">{selectedAgent.name}</h3>
                    <p className="text-xs text-text-muted">Agent ID: {selectedAgent.id}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedAgent(null)}
                  className="rounded-lg p-2 text-text-muted hover:bg-dark-bg hover:text-text-primary"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-4 overflow-y-auto">
                {/* Current Objective */}
                <div className="mb-6">
                  <p className="text-xs text-text-muted mb-2">Current Objective</p>
                  <div className="rounded-lg bg-dark-bg p-3 border border-dark-border">
                    <p className="text-sm text-text-primary">{selectedAgent.currentTask || 'Waiting for task assignment'}</p>
                    <ProgressBar
                      value={selectedAgent.progress}
                      max={100}
                      color="yellow"
                      showLabel
                      className="mt-3"
                    />
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-4 gap-3 mb-6">
                  <div className="text-center rounded-lg bg-dark-bg p-3">
                    <p className="text-lg font-semibold text-text-primary">{selectedAgent.runtime}s</p>
                    <p className="text-[10px] text-text-muted">Runtime</p>
                  </div>
                  <div className="text-center rounded-lg bg-dark-bg p-3">
                    <p className="text-lg font-semibold text-text-primary">{selectedAgent.tokens.toLocaleString()}</p>
                    <p className="text-[10px] text-text-muted">Tokens</p>
                  </div>
                  <div className="text-center rounded-lg bg-dark-bg p-3">
                    <p className="text-lg font-semibold text-ey-yellow">${selectedAgent.cost.toFixed(2)}</p>
                    <p className="text-[10px] text-text-muted">Cost</p>
                  </div>
                  <div className="text-center rounded-lg bg-dark-bg p-3">
                    <p className="text-lg font-semibold text-status-success">{selectedAgent.progress}%</p>
                    <p className="text-[10px] text-text-muted">Progress</p>
                  </div>
                </div>

                {/* Execution History */}
                <div className="mb-6">
                  <p className="text-xs text-text-muted mb-2">Execution History</p>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {[
                      'Started task execution',
                      'Loaded context from previous agent',
                      'Processing requirements',
                      'Generating output artifacts',
                    ].map((action, index) => (
                      <div key={index} className="flex items-center gap-2 text-xs">
                        <CheckCircle2 className="h-3 w-3 text-status-success" />
                        <span className="text-text-secondary">{action}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Generated Artifacts */}
                <div className="mb-6">
                  <p className="text-xs text-text-muted mb-2">Generated Artifacts</p>
                  <div className="space-y-2">
                    {[
                      { name: 'architecture_v2.yaml', type: 'Config' },
                      { name: 'system-diagram.json', type: 'Diagram' },
                      { name: 'api-specification.yaml', type: 'API' },
                    ].map((artifact, index) => (
                      <div key={index} className="flex items-center justify-between rounded-lg bg-dark-bg p-2">
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-ey-yellow" />
                          <span className="text-xs text-text-primary">{artifact.name}</span>
                        </div>
                        <span className="text-[10px] text-text-muted">{artifact.type}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Dependencies */}
                <div>
                  <p className="text-xs text-text-muted mb-2">Dependencies</p>
                  <div className="flex gap-2">
                    <StatusBadge status="success">Requirement Agent</StatusBadge>
                    <StatusBadge status="success">Business Analyst Agent</StatusBadge>
                  </div>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 border-t border-dark-border p-4">
                <button className="btn-ghost text-sm">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Restart Agent
                </button>
                <button className="btn-secondary text-sm">
                  <Settings className="mr-2 h-4 w-4" />
                  Configure
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}