import { motion } from 'framer-motion';
import {
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
  ChevronRight,
  Code,
  Lightbulb,
  Layers,
  FileCheck,
  Radar,
} from 'lucide-react';
import type { AgentStatus } from '../../types';

interface AgentNodeProps {
  name: string;
  icon: React.ElementType;
  status: AgentStatus;
  active?: boolean;
}

function AgentNode({ name, icon: Icon, status, active }: AgentNodeProps) {
  const statusColors: Record<string, string> = {
    running: 'border-ey-yellow bg-ey-yellow/10 text-ey-yellow',
    completed: 'border-status-success bg-status-success/10 text-status-success',
    waiting: 'border-status-warning bg-status-warning/10 text-status-warning',
    failed: 'border-status-error bg-status-error/10 text-status-error',
    idle: 'border-dark-border bg-dark-bg text-text-muted',
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-all whitespace-nowrap ${
        active ? 'ring-2 ring-ey-yellow/50' : ''
      } ${statusColors[status]}`}
    >
      <Icon className="h-4 w-4" />
      <span className="text-xs font-medium">{name}</span>
      {status === 'running' && (
        <span className="ml-1 h-1.5 w-1.5 rounded-full bg-ey-yellow animate-pulse" />
      )}
    </motion.div>
  );
}

// Updated workflow: Memory → Requirements → Business Analyst → Human Review 1 → Solution Architect → Database Design → UI/UX → Security Architect → Compliance Architect → Human Review 2 → Frontend → Backend → Code Review → Testing → Documentation → DevOps → Deployment
const agents = [
  { name: 'Memory Agent', icon: Lightbulb, status: 'completed' as AgentStatus },
  { name: 'Requirement Agent', icon: FileSearch, status: 'completed' as AgentStatus },
  { name: 'Business Analyst Agent', icon: Briefcase, status: 'completed' as AgentStatus },
  { name: 'Human Review 1', icon: FileCheck, status: 'completed' as AgentStatus },
  { name: 'Solution Architect Agent', icon: Building2, status: 'running' as AgentStatus },
  { name: 'Database Design Agent', icon: Database, status: 'waiting' as AgentStatus },
  { name: 'UI/UX Design Agent', icon: Monitor, status: 'idle' as AgentStatus },
  { name: 'Security Architect Agent', icon: Shield, status: 'idle' as AgentStatus },
  { name: 'Compliance Architect Agent', icon: Radar, status: 'idle' as AgentStatus },
  { name: 'Human Review 2', icon: FileCheck, status: 'idle' as AgentStatus },
  { name: 'Frontend Agent', icon: Layers, status: 'idle' as AgentStatus },
  { name: 'Backend Agent', icon: Server, status: 'idle' as AgentStatus },
  { name: 'Code Review Agent', icon: Code, status: 'idle' as AgentStatus },
  { name: 'Testing Agent', icon: TestTube, status: 'idle' as AgentStatus },
  { name: 'Documentation Agent', icon: FileText, status: 'idle' as AgentStatus },
  { name: 'DevOps Agent', icon: Rocket, status: 'idle' as AgentStatus },
  { name: 'Deployment Agent', icon: Rocket, status: 'idle' as AgentStatus },
];

export function AgentWorkflow() {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {agents.map((agent, index) => (
        <div key={agent.name} className="flex items-center">
          <AgentNode
            name={agent.name}
            icon={agent.icon}
            status={agent.status}
            active={agent.status === 'running'}
          />
          {index < agents.length - 1 && (
            <ChevronRight className="mx-1 h-4 w-4 text-dark-border-light flex-shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}
