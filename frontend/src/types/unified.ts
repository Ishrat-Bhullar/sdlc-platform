/**
 * Unified SDLC Studio Type System
 * Single source of truth for all frontend/backend data models
 */

// ─── Core Pipeline Models ─────────────────────────────────────────────────────

export interface PipelineRun {
  id: string;
  project_id: string;
  status: 'idle' | 'running' | 'waiting_approval' | 'completed' | 'failed';
  current_stage: string | null;
  current_agent: string | null;
  completed_stages: number;
  total_stages: number;
  percentage: number;
  started_at: string | null;
  completed_at: string | null;
}

export interface AgentRun {
  id: string;
  project_id: string;
  agent_name: string;
  agent_key: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_approval';
  start_time: string | null;
  end_time: string | null;
  output_url: string | null;
  error_message?: string;
  artifacts: Artifact[];
  approval?: Approval;
}

export interface Artifact {
  id: string;
  project_id: string;
  artifact_type: ArtifactType;
  content: string | Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  version: number;
  approval_status?: ApprovalStatus;
  download_formats?: string[];
}

export type ArtifactType =
  | 'requirements_doc'
  | 'user_stories'
  | 'architecture_diagram'
  | 'sql_schema'
  | 'api_design'
  | 'uiux_design'
  | 'security_report'
  | 'compliance_report'
  | 'react_code'
  | 'backend_code'
  | 'test_report'
  | 'documentation'
  | 'presentation'
  | 'presentation_pptx'
  | 'presentation_director'
  | 'presentation_logic'
  | 'presentation_review'
  | 'review_1_checkpoint'
  | 'review_2_checkpoint'
  | 'api_response_mock'
  | 'architecture_proposals'
  | 'database_schema'
  | 'ui_ux_design'
  | 'security_architecture'
  | 'compliance_architecture';

export interface Approval {
  id: string;
  project_id: string;
  artifact_type: ArtifactType;
  status: ApprovalStatus;
  approved_by: string | null;
  comments: string | null;
  notes: string | null;
  created_at: string;
  decided_at?: string;
}

export type ApprovalStatus =
  | 'Draft Generated'
  | 'Pending Approval'
  | 'Approved'
  | 'Rejected'
  | 'Published';

export interface TimelineEvent {
  id: string;
  project_id: string;
  stage: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  timestamp: string;
  agent_name?: string;
  metadata?: Record<string, unknown>;
}

// ─── Workspace Content Models ─────────────────────────────────────────────────

export interface RequirementsContent {
  requirements: Requirement[];
  assumptions: string[];
  risks: string[];
  dependencies?: Dependency[];
  acceptanceCriteria?: AcceptanceCriterion[];
  summary?: Record<string, unknown>;
}

export interface Requirement {
  id: string;
  description: string;
  category: 'Functional' | 'Non-Functional' | 'Constraint' | 'Assumption';
  priority: 'critical' | 'high' | 'medium' | 'low';
  risk_level: 'high' | 'medium' | 'low';
  status?: string;
  source?: string;
}

export interface Dependency {
  id: string;
  name: string;
  type: string;
  description: string;
  status: string;
  criticality: string;
}

export interface UserStoriesContent {
  epics: Epic[];
  total_stories: number;
}

export interface Epic {
  title: string;
  description: string;
  stories: UserStory[];
}

export interface UserStory {
  id: string;
  epic: string;
  title: string;
  role: string;
  goal: string;
  benefit: string;
  acceptance_criteria: AcceptanceCriterion[];
  moscow: 'Must' | 'Should' | 'Could' | 'Won\'t';
  points: number;
}

export interface AcceptanceCriterion {
  given: string;
  when: string;
  then: string;
}

export interface ArchitectureContent {
  architecture_summary: string;
  pattern: string;
  microservices: Microservice[];
  components: Component[];
  diagrams: Diagram[];
  tech_stack: Record<string, string>;
}

export interface Microservice {
  name: string;
  responsibility: string;
  technology: string;
  port?: number;
}

export interface Component {
  name: string;
  type: 'frontend' | 'backend' | 'database' | 'queue' | 'cache' | 'gateway';
  technology: string;
}

export interface Diagram {
  type: string;
  content: string;
}

export interface DatabaseSchemaContent {
  tables: TableDef[];
  relationships: RelationshipDef[];
  sql_ddl: string;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  indexes: string[];
}

export interface ColumnDef {
  name: string;
  type: string;
  nullable: boolean;
  primary_key: boolean;
  foreign_key?: string;
  unique?: boolean;
  default?: string;
}

export interface RelationshipDef {
  from_table: string;
  to_table: string;
  type: 'one-to-many' | 'many-to-many' | 'one-to-one';
  via?: string;
}

export interface ApiDesignContent {
  api_style: 'REST' | 'GraphQL' | 'gRPC';
  base_url: string;
  endpoints: ApiEndpoint[];
  openapi_yaml: string;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  summary: string;
  request_body?: Record<string, unknown>;
  response_shape?: Record<string, unknown>;
  auth_required: boolean;
}

export interface UIUXDesignContent {
  screens: string[];
  userFlows: string[];
  wireframes: string[];
  componentRecommendations: string[];
  uxRecommendations: string[];
}

export interface SecurityReportContent {
  securityArchitecture: {
    layers: string[];
    controls: string[];
    patterns: string[];
  };
  threatModel: string[];
  authentication: {
    strategy: string;
    providers: string[];
    mfa: boolean;
    sessionManagement: string;
  };
  authorization: {
    model: string;
    roles: string[];
    permissions: string[];
    policies: string[];
  };
  securityControls: string[];
  securityChecklist: string[];
}

export interface ComplianceReportContent {
  complianceAssessment: {
    standards: string[];
    gaps: string[];
    recommendations: string[];
  };
  governanceControls: string[];
  auditRequirements: string[];
  dataRetentionPolicies: string[];
  riskAssessment: string[];
}

export interface GeneratedCodeContent {
  framework: string;
  modules: string[];
  implementation: string;
  files?: CodeFile[];
}

export interface CodeFile {
  path: string;
  name: string;
  content: string;
  language: string;
}

export interface TestReportContent {
  summary: string;
  suites: string[];
  status: 'passed' | 'failed' | 'pending';
  coverage_targets: Record<string, number>;
}

export interface DocumentationContent {
  documents: string[];
  format: 'Markdown' | 'PDF' | 'HTML';
  status: 'generated' | 'pending' | 'failed';
}

// ─── Dashboard & Monitoring Models ───────────────────────────────────────────

export interface DashboardSummary {
  total_projects: number;
  active_projects: number;
  completed_projects: number;
  total_agent_runs: number;
  running_agents: number;
  completed_agents: number;
  failed_agents: number;
  pending_approvals: number;
  total_artifacts: number;
  total_documents: number;
}

export interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  source: string;
  timestamp: string;
  acknowledged: boolean;
}

// ─── Helper Types ─────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ApiError {
  detail: string;
  status?: number;
}
