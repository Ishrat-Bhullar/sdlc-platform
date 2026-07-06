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
  user_roles?: UserRole[];
  traceability?: TraceabilityEntry[];
  error_scenarios?: ErrorScenario[];
}

export interface Requirement {
  id: string;
  description: string;
  category: 'Functional' | 'Non-Functional' | 'Constraint' | 'Assumption';
  priority: 'critical' | 'high' | 'medium' | 'low';
  risk_level: 'high' | 'medium' | 'low';
  status?: string;
  source?: string;
  // Implementation-ready per-requirement detail (rendered by RequirementCard's accordion)
  business_rules?: string[];
  edge_cases?: string[];
  validations?: string[];
  workflow?: string[];
  acceptance_criteria?: AcceptanceCriterion[];
  api_considerations?: { endpoints?: Array<{ method: string; path: string; desc?: string; success?: string; errors?: string }>; notes?: string[] };
  ui_behavior?: string[];
  db_impact?: { primary_table?: string; columns_touched?: string[]; notes?: string[] };
  dependencies?: string[];
  constraints?: string[];
  nfr_targets?: Record<string, string>;
  assumptions?: string[];
}

export interface UserRole {
  name: string;
  description?: string;
  permissions?: string[];
}

export interface TraceabilityEntry {
  requirement_id: string;
  business_goal?: string;
  source?: string;
  related_requirements?: string[];
}

export interface ErrorScenario {
  requirement_id: string;
  scenario: string;
  expected_behavior?: string;
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
  detailed_brd?: string;
  srs?: string;
  personas?: Persona[];
  process_flows?: ProcessFlow[];
  business_workflows?: string[];
  validation_rules?: string[];
  exception_handling?: string[];
  risk_analysis?: RiskAnalysisItem[];
  success_metrics?: SuccessMetric[];
}

export interface Persona {
  name: string;
  role?: string;
  goals?: string[];
  pain_points?: string[];
  demographics?: string;
}

export interface ProcessFlow {
  name: string;
  steps?: string[];
  diagram?: string;
}

export interface RiskAnalysisItem {
  risk: string;
  likelihood?: string;
  impact?: string;
  mitigation?: string;
}

export interface SuccessMetric {
  metric: string;
  target?: string;
  measurement_method?: string;
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
  architecture_decisions: ArchitectureDecisionItem[];
}

export interface ArchitectureDecisionItem {
  decision: string;
  rationale: string;
  alternatives_considered?: string;
  consequences: string;
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
  normalization_notes?: string;
  audit_tables?: string[];
  sample_data?: Record<string, Array<Record<string, unknown>>>;
  scaling_strategy?: string;
  partitioning_recommendations?: string;
  design_decisions?: { decision: string; rationale: string }[];
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
  description: string;
  request_body?: string | null;
  response?: string;
  auth_required: boolean;
}

export interface UIUXScreen {
  name: string;
  purpose: string;
  type: string;
  components: string[];
}

export interface UIUXUserFlow {
  name: string;
  steps: string[];
  screens: string[];
}

export interface UIUXWireframe {
  screen: string;
  layout: string;
  description: string;
}

export interface UIUXComponentRecommendation {
  name: string;
  type: string;
  library: string;
  rationale: string;
}

export interface UIUXDesignContent {
  screens: UIUXScreen[];
  userFlows: UIUXUserFlow[];
  wireframes: UIUXWireframe[];
  componentRecommendations: UIUXComponentRecommendation[];
  uxRecommendations: string[];
}

export interface SecurityThreat {
  threat: string;
  impact: string;
  likelihood: string;
  mitigation: string;
}

export interface SecurityControlItem {
  control: string;
  category: string;
  implementation: string;
}

export interface SecurityReportContent {
  securityArchitecture: {
    layers: string[];
    controls: string[];
    patterns: string[];
  };
  threatModel: SecurityThreat[];
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
  securityControls: SecurityControlItem[];
  securityChecklist: string[];
}

export interface GovernanceControl {
  control: string;
  framework: string;
  requirement: string;
  implementation: string;
}

export interface AuditRequirement {
  requirement: string;
  frequency: string;
  evidence: string;
  responsible: string;
}

export interface DataRetentionPolicy {
  dataType: string;
  retentionPeriod: string;
  deletionMethod: string;
  justification: string;
}

export interface RiskAssessmentItem {
  risk: string;
  likelihood: string;
  impact: string;
  mitigation: string;
  owner: string;
}

export interface ComplianceReportContent {
  complianceAssessment: {
    standards: string[];
    gaps: string[];
    recommendations: string[];
  };
  governanceControls: GovernanceControl[];
  auditRequirements: AuditRequirement[];
  dataRetentionPolicies: DataRetentionPolicy[];
  riskAssessment: RiskAssessmentItem[];
}

export interface GeneratedCodeContent {
  framework: string;
  modules: string[];
  implementation: string;
  files?: CodeFile[];
  // Frontend-specific
  folder_structure?: string[];
  component_architecture?: FrontendComponentSpec[];
  routing?: RouteSpec[];
  state_management?: StateManagementPlan;
  api_integration_plan?: ApiIntegrationItem[];
  forms?: FormSpec[];
  error_handling?: string[];
  reusable_components?: ReusableComponentSpec[];
  // Backend-specific
  api_specifications?: EndpointSpec[];
  authentication?: { strategy?: string; token_type?: string; session_handling?: string };
  authorization?: { model?: string; roles?: string[]; permission_matrix?: Record<string, string[]> };
  service_layer?: ServiceSpec[];
  repository_layer?: RepositorySpec[];
  validation?: string[];
  exception_handling?: ExceptionHandlingSpec[];
  background_jobs?: BackgroundJobSpec[];
}

export interface CodeFile {
  path: string;
  name: string;
  content: string;
  language: string;
}

export interface FrontendComponentSpec {
  name: string;
  type?: string;
  responsibility?: string;
  props?: string[];
  children?: string[];
}

export interface RouteSpec {
  path: string;
  component?: string;
  guarded?: boolean;
  description?: string;
}

export interface StateManagementPlan {
  approach?: string;
  rationale?: string;
  stores?: Array<{ name: string; shape?: string; purpose?: string }>;
}

export interface ApiIntegrationItem {
  endpoint: string;
  method?: string;
  hook_name?: string;
  error_handling?: string;
  loading_state?: string;
}

export interface FormSpec {
  name: string;
  fields?: Array<{ name: string; type?: string; validation?: string }>;
  submit_behavior?: string;
}

export interface ReusableComponentSpec {
  name: string;
  purpose?: string;
  props?: string[];
  variants?: string[];
}

export interface EndpointSpec {
  method: string;
  path: string;
  summary?: string;
  request_schema?: Record<string, unknown>;
  response_schema?: Record<string, unknown>;
  status_codes?: Record<string, string>;
}

export interface ServiceSpec {
  name: string;
  responsibility?: string;
  methods?: string[];
  depends_on?: string[];
}

export interface RepositorySpec {
  name: string;
  entity?: string;
  methods?: string[];
}

export interface ExceptionHandlingSpec {
  exception_type: string;
  http_status?: string;
  handling_strategy?: string;
}

export interface BackgroundJobSpec {
  name: string;
  trigger?: string;
  schedule?: string;
  purpose?: string;
}

export interface TestReportContent {
  summary: string;
  suites: string[];
  status: 'passed' | 'failed' | 'pending';
  coverage_targets: Record<string, number>;
  unit_tests?: TestCaseSpec[];
  integration_tests?: TestCaseSpec[];
  api_tests?: TestCaseSpec[];
  ui_tests?: TestCaseSpec[];
  performance_tests?: TestCaseSpec[];
  security_tests?: TestCaseSpec[];
  edge_cases?: string[];
  test_data?: TestDataSpec[];
}

export interface TestCaseSpec {
  id: string;
  name: string;
  target?: string;
  scenario?: string;
  expected_result?: string;
}

export interface TestDataSpec {
  entity: string;
  sample_payload?: Record<string, unknown>;
  purpose?: string;
}

export interface DocumentationContent {
  documents: string[];
  format: 'Markdown' | 'PDF' | 'HTML';
  status: 'generated' | 'pending' | 'failed';
  developer_guide?: string;
  deployment_guide?: string;
  installation_guide?: string;
  api_documentation?: string;
  operations_guide?: string;
  maintenance_guide?: string;
  troubleshooting?: TroubleshootingItem[];
  faqs?: FAQItem[];
}

export interface TroubleshootingItem {
  issue: string;
  symptoms?: string;
  resolution?: string;
}

export interface FAQItem {
  question: string;
  answer?: string;
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
