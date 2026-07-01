export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  progress: number;
  createdAt: Date;
  updatedAt: Date;
  agents: Agent[];
}

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  currentTask?: string;
  progress: number;
  runtime: number;
  tokens: number;
  cost: number;
  lastActivity: Date;
}

export type AgentType =
  | 'requirement'
  | 'business-analyst'
  | 'architect'
  | 'database'
  | 'frontend'
  | 'backend'
  | 'code-review'
  | 'testing'
  | 'security'
  | 'documentation'
  | 'devops'
  | 'memory'
  | 'knowledge';

export type AgentStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'idle';

export interface Approval {
  id: string;
  type: 'architecture' | 'database' | 'security' | 'deployment' | 'compliance';
  title: string;
  description: string;
  owner: string;
  timestamp: Date;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'approved' | 'rejected';
  changes?: Change[];
}

export interface Change {
  id: string;
  type: string;
  description: string;
  before?: string;
  after?: string;
}

export interface MCPIntegration {
  id: string;
  name: string;
  type: string;
  status: 'connected' | 'disconnected' | 'error' | 'syncing';
  latency: number;
  lastSync: Date;
  connectedAgents: string[];
}

export interface SDLCStage {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  startTime?: Date;
  endTime?: Date;
}

export interface MetricCard {
  id: string;
  title: string;
  value: string | number;
  change?: number;
  trend?: 'up' | 'down' | 'neutral';
  icon?: string;
}

export interface TimelineEvent {
  id: string;
  timestamp: Date;
  agent: string;
  action: string;
  result: string;
  stage: string;
}

export interface UserStory {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'todo' | 'in-progress' | 'review' | 'done';
  epic: string;
  points: number;
}

export interface ArchitectureComponent {
  id: string;
  name: string;
  type: 'service' | 'database' | 'api' | 'frontend' | 'external';
  connections: string[];
  metadata?: Record<string, unknown>;
}

export interface DatabaseTable {
  id: string;
  name: string;
  columns: DatabaseColumn[];
  relationships: string[];
  indexes: string[];
}

export interface DatabaseColumn {
  name: string;
  type: string;
  nullable: boolean;
  primary: boolean;
  foreign?: string;
}

export interface GeneratedFile {
  id: string;
  path: string;
  name: string;
  content: string;
  lines: number;
  generatedAt: Date;
  generator: string;
}

export interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  source: string;
  timestamp: Date;
  acknowledged: boolean;
}

export interface CostMetric {
  name: string;
  current: number;
  previous: number;
  unit: string;
}