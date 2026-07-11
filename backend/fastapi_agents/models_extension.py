"""
models_extension.py
====================
Additive Pydantic schemas and SQLAlchemy helpers required by the missing
Friday-demo endpoints.  Nothing here redefines anything already in models.py.

Import pattern in main_extension.py:
from .models import Base, Project, ...          (existing)

from .models_extension import *                 (new schemas only)


"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Project list / detail
# ---------------------------------------------------------------------------

class ProjectListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: str | None
    project_type: str
    execution_mode: str
    build_type: str
    status: str
    created_at: datetime


class ProjectDetailOut(ProjectListOut):
    """Extends the list shape with child counts."""
    agent_run_count: int = 0
    deliverable_count: int = 0
    artifact_count: int = 0


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

class DashboardSummaryOut(BaseModel):
    total_projects: int
    active_projects: int
    completed_projects: int
    total_agent_runs: int
    running_agents: int
    completed_agents: int
    failed_agents: int
    pending_approvals: int
    total_artifacts: int
    total_documents: int


class DashboardAgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    agent_name: str
    status: str
    start_time: datetime | None
    end_time: datetime | None
    output_url: str | None


class DashboardGovernanceOut(BaseModel):
    total_approvals: int
    pending: int
    approved: int
    rejected: int
    published: int
    recent: list[dict[str, Any]]


# ---------------------------------------------------------------------------
# Jira import
# ---------------------------------------------------------------------------

class JiraImportRequest(BaseModel):
    jira_url: str
    project_key: str
    username: str
    token: str
    target_project_id: int


class JiraImportResponse(BaseModel):
    stories_imported: int
    epics_imported: int
    artifacts_created: int
    project_id: int


# ---------------------------------------------------------------------------
# Generate / requirements
# ---------------------------------------------------------------------------

class GenerateRequirementsRequest(BaseModel):
    prompt: str
    document_ids: list[int] = Field(default_factory=list)
    project_id: int


class Requirement(BaseModel):
    id: str
    description: str
    category: str          # Functional | Non-Functional | Constraint | Assumption
    priority: str          # critical | high | medium | low
    risk_level: str        # high | medium | low


class GenerateRequirementsResponse(BaseModel):
    project_id: int
    artifact_id: int
    requirements: list[Requirement]
    assumptions: list[str]
    risks: list[str]


# ---------------------------------------------------------------------------
# Generate / user stories
# ---------------------------------------------------------------------------

class GenerateUserStoriesRequest(BaseModel):
    project_id: int
    requirements_artifact_id: int | None = None   # if None, fetches latest requirements artifact


class AcceptanceCriterion(BaseModel):
    given: str
    when: str
    then: str


class UserStoryOut(BaseModel):
    id: str
    epic: str
    title: str
    role: str
    goal: str
    benefit: str
    acceptance_criteria: list[AcceptanceCriterion]
    moscow: str    # Must | Should | Could | Won't
    points: int


class EpicOut(BaseModel):
    title: str
    description: str
    stories: list[UserStoryOut]


class GenerateUserStoriesResponse(BaseModel):
    project_id: int
    artifact_id: int
    epics: list[EpicOut]
    total_stories: int


# ---------------------------------------------------------------------------
# Generate / architecture
# ---------------------------------------------------------------------------

class GenerateArchitectureRequest(BaseModel):
    project_id: int


class MicroserviceOut(BaseModel):
    name: str
    responsibility: str
    technology: str
    port: int | None = None


class ComponentOut(BaseModel):
    name: str
    type: str    # frontend | backend | database | queue | cache | gateway
    technology: str


class GenerateArchitectureResponse(BaseModel):
    project_id: int
    artifact_id: int
    architecture_summary: str
    pattern: str
    microservices: list[MicroserviceOut]
    components: list[ComponentOut]
    diagrams: list[dict[str, str]]   # [{type, content}]  e.g. mermaid strings
    tech_stack: dict[str, str]


# ---------------------------------------------------------------------------
# Generate / database schema
# ---------------------------------------------------------------------------

class GenerateDatabaseSchemaRequest(BaseModel):
    project_id: int


class ColumnDef(BaseModel):
    name: str
    type: str
    nullable: bool = True
    primary_key: bool = False
    foreign_key: str | None = None   # "other_table.id"
    unique: bool = False
    default: str | None = None


class TableDef(BaseModel):
    name: str
    columns: list[ColumnDef]
    indexes: list[str] = Field(default_factory=list)


class RelationshipDef(BaseModel):
    from_table: str
    to_table: str
    type: str    # one-to-many | many-to-many | one-to-one
    via: str | None = None   # junction table for many-to-many


class GenerateDatabaseSchemaResponse(BaseModel):
    project_id: int
    artifact_id: int
    tables: list[TableDef]
    relationships: list[RelationshipDef]
    sql_ddl: str


# ---------------------------------------------------------------------------
# Generate / api design
# ---------------------------------------------------------------------------

class GenerateApiDesignRequest(BaseModel):
    project_id: int


class EndpointDef(BaseModel):
    method: str
    path: str
    # The API design agent (ai_service.generate_api_design / ApiDesignResult)
    # produces `description` and string examples for request/response bodies,
    # not a `summary` field or nested dict schemas — this model previously
    # didn't match that shape, which raised a ResponseValidationError (500)
    # on every real generation once an LLM key was configured.
    description: str = ""
    request_body: str | None = None
    response: str = ""
    auth_required: bool = True


class GenerateApiDesignResponse(BaseModel):
    project_id: int
    artifact_id: int
    api_style: str    # REST | GraphQL | gRPC
    base_url: str
    endpoints: list[EndpointDef]
    openapi_yaml: str


# ---------------------------------------------------------------------------
# Database workspace
# ---------------------------------------------------------------------------

class MigrationOut(BaseModel):
    version: str
    description: str
    applied: bool
    sql_up: str
    sql_down: str


class DatabaseSchemaOut(BaseModel):
    project_id: int
    tables: list[TableDef]
    approval_status: str


class DatabaseRelationshipsOut(BaseModel):
    project_id: int
    relationships: list[RelationshipDef]


class DatabaseSqlPreviewOut(BaseModel):
    project_id: int
    sql_ddl: str


class DatabaseMigrationsOut(BaseModel):
    project_id: int
    migrations: list[MigrationOut]


class ApproveSchemaDatabaseOut(BaseModel):
    project_id: int
    approval_id: int
    status: str
    approved_at: datetime


# ---------------------------------------------------------------------------
# Documentation center
# ---------------------------------------------------------------------------

class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    file_name: str
    document_type: str
    storage_path: str
    uploaded_at: datetime
    # Enrichment fields (computed)
    category: str = ""
    size_bytes: int = 0


class DocumentCategoryOut(BaseModel):
    category: str
    documents: list[DocumentOut]
    count: int


class ExportAllResponse(BaseModel):
    exported: int
    archive_path: str
    document_ids: list[int]


# ---------------------------------------------------------------------------
# Approvals
# ---------------------------------------------------------------------------

class ApprovalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    artifact_type: str
    status: str
    approved_by: int | None
    comments: str | None


class ApprovalDecisionRequest(BaseModel):
    decision: str         # approved | rejected | published
    comments: str | None = None
    # Only used for artifact_type == "ui_style_selection" approvals — the
    # style card the user picked (name/colorPalette/typography/etc, same
    # shape as one entry of the UI/UX Agent's styleOptions). Persisted as a
    # new GeneratedArtifact so the Frontend Agent's context can pick it up.
    selection: dict | None = None


class ApprovalDecisionOut(BaseModel):
    approval_id: int
    new_status: str
    decided_at: datetime


class SelectedDesignUpdateRequest(BaseModel):
    # The full selected_ui_style object (same shape as one StyleOption),
    # with the user's Design Canvas edits (component insert/remove/reorder/
    # rename) already applied to its `screens`. Persisted as a new
    # GeneratedArtifact version — same pattern as every other artifact
    # write in this app — so it becomes what the Frontend Agent's context
    # picks up on its next run.
    design: dict
    decided_by: int


# ---------------------------------------------------------------------------
# AI Review Copilot
# ---------------------------------------------------------------------------

class ReviewRequest(BaseModel):
    project_id: int
    artifact_id: int | None = None   # if None, uses latest artifact of the relevant type
    context: str | None = None       # optional extra instructions


class ReviewFinding(BaseModel):
    severity: str        # critical | major | minor | info
    category: str
    description: str
    recommendation: str
    line_reference: str | None = None


class ReviewResponse(BaseModel):
    project_id: int
    review_type: str
    score: float
    risk_level: str      # low | medium | high | critical
    summary: str
    findings: list[ReviewFinding]
    recommendations: list[str]
    artifact_id: int     # the newly stored review_result row id


# ---------------------------------------------------------------------------
# BYOK provider configuration
# ---------------------------------------------------------------------------

class ProviderConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())
    id: int
    project_id: int
    provider_name: str
    enabled: bool
    base_url: str | None = None
    model: str | None = None
    api_version: str | None = None
    # encrypted_key is intentionally NEVER echoed back

class ProviderListOut(BaseModel):
    providers: list[ProviderConfigOut]
    supported: list[str]    # canonical list of provider names the platform supports


class ProviderConfigureRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    project_id: int
    provider_name: str
    api_key: str
    enabled: bool = True
    base_url: str | None = None      # required for azure_openai / openai_compatible
    model: str | None = None
    api_version: str | None = None   # azure_openai only


class ProviderConfigureOut(BaseModel):
    provider_id: int
    provider_name: str
    enabled: bool
    key_stored: bool


class ProviderTestRequest(BaseModel):
    project_id: int
    provider_name: str


class ProviderTestOut(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    provider_name: str
    reachable: bool
    latency_ms: int
    model_tested: str
    message: str


# ---------------------------------------------------------------------------
# WebSocket event envelope (used by the connection manager)
# ---------------------------------------------------------------------------

class WsEvent(BaseModel):
    event: str          # agent_started | agent_completed | artifact_generated |
                        # approval_requested | approval_completed | review_completed
    project_id: int
    payload: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)
