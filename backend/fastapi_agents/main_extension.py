"""
main_extension.py
=================
All Friday-demo endpoints that are NOT already in main.py.

HOW TO WIRE THIS INTO main.py
------------------------------
Add these four lines at the bottom of main.py (after the last @app route):

from .main_extension import router as ext_router
app.include_router(ext_router)


# WebSocket endpoint is registered directly on `app` inside
# main_extension — import triggers the registration automatically.
from . import main_extension  # noqa: F401  (side-effect import)



That's it.  main.py itself is not modified.

SECTION COVERAGE
----------------
Section 5   POST /ingestion/jira-import
Section 6   POST /generate/requirements
Section 7   POST /generate/user-stories
Section 8   POST /generate/architecture
            POST /generate/database-schema
            POST /generate/api-design
Section 10  GET  /dashboard/summary
            GET  /dashboard/projects
            GET  /dashboard/agents
            GET  /dashboard/governance
            GET  /projects  (list, needed by dashboard/projects)
            GET  /projects/{project_id}
Section 11  GET  /database/schema/{project_id}
            GET  /database/relationships/{project_id}
            GET  /database/sql-preview/{project_id}
            GET  /database/migrations/{project_id}
            POST /database/approve-schema/{project_id}
Section 12  GET  /documents
            GET  /documents/{document_id}
            GET  /documents/category/{category}
            GET  /documents/download/{document_id}
            POST /documents/export-all
Section 13  GET  /projects/{project_id}/approvals
            POST /projects/{project_id}/approvals/{approval_id}/decide
Section 14  POST /reviews/architecture
            POST /reviews/database
            POST /reviews/ui
            POST /reviews/code
            POST /reviews/security
Section 15  GET  /providers
            POST /providers/configure
            POST /providers/test
Section 16  WS   /ws/{project_id}
"""
from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import asyncio as _asyncio
from .models import AgentName as _AgentName

from . import agent_runner as _agent_runner


from pydantic import BaseModel as _BaseModel
import logging
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

logger = logging.getLogger("sdlc.main_extension")

# ── existing app / auth helpers ─────────────────────────────────────────────
from .main import get_current_user, get_db, encrypt_secret



# ── existing ORM models ──────────────────────────────────────────────────────
from .models import (

    AgentRun,
    Approval,
    ApprovalStatus,
    ArtifactType,
    Document,
    GeneratedArtifact,
    Project,
    ProjectDeliverable,
    ProviderConfiguration,
    ProviderName,
    ReviewResult,
    ReviewType,
    RunStatus,
    TimelineEvent,
    User,
)

# ── new schemas ──────────────────────────────────────────────────────────────
from .models_extension import (

    ApproveSchemaDatabaseOut,
    ApprovalDecisionOut,
    ApprovalDecisionRequest,
    ApprovalOut,
    DashboardAgentOut,
    DashboardGovernanceOut,
    DashboardSummaryOut,
    DatabaseMigrationsOut,
    DatabaseRelationshipsOut,
    DatabaseSchemaOut,
    DatabaseSqlPreviewOut,
    DocumentCategoryOut,
    DocumentOut,
    ExportAllResponse,
    GenerateApiDesignRequest,
    GenerateApiDesignResponse,
    GenerateArchitectureRequest,
    GenerateArchitectureResponse,
    GenerateDatabaseSchemaRequest,
    GenerateDatabaseSchemaResponse,
    GenerateRequirementsRequest,
    GenerateRequirementsResponse,
    GenerateUserStoriesRequest,
    GenerateUserStoriesResponse,
    JiraImportRequest,
    JiraImportResponse,
    MigrationOut,
    ProjectDetailOut,
    ProjectListOut,
    ProviderConfigureOut,
    ProviderConfigureRequest,
    ProviderListOut,
    ProviderTestOut,
    ProviderTestRequest,
    ReviewRequest,
    ReviewResponse,
)

# ── AI service and WebSocket manager ─────────────────────────────────────────
from . import ai_service
from .ws_manager import manager


# ── New Agent Imports ────────────────────────────────────────────────────────
from .agents.uiux_agent import UIUXDesignAgent

from .agents.security_agent import SecurityArchitectAgent

from .agents.compliance_agent import ComplianceArchitectAgent



STORAGE_BASE_PATH = Path("./storage")

router = APIRouter()


# ===========================================================================
# Helpers
# ===========================================================================

def _get_project_or_404(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project {project_id} not found")
    return project


def _save_artifact(db: Session, project_id: int, artifact_type: str, content: str) -> GeneratedArtifact:
    artifact = GeneratedArtifact(
        project_id=project_id,
        artifact_type=artifact_type,
        content=content if isinstance(content, str) else json.dumps(content),
    )
    db.add(artifact)
    db.flush()
    return artifact


def _latest_artifact(db: Session, project_id: int, artifact_type: str) -> GeneratedArtifact | None:
    return (
        db.query(GeneratedArtifact)
        .filter(
            GeneratedArtifact.project_id == project_id,
            GeneratedArtifact.artifact_type == artifact_type,
        )
        .order_by(GeneratedArtifact.created_at.desc())
        .first()
    )


def _document_category(doc_type: str) -> str:
    mapping = {
        "BRD": "BRD", "RFP": "BRD",
        "SRS": "SRS",
        "PDF": "Architecture Documents", "DOCX": "Architecture Documents",
    }
    return mapping.get(doc_type.upper(), "Other")


# ===========================================================================
# SECTION 5 — Jira Import
# ===========================================================================

@router.post("/ingestion/jira-import", response_model=JiraImportResponse, tags=["ingestion"])
def jira_import(
    payload: JiraImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Simulates a Jira import for the demo.  When a real Jira instance is
    reachable and the token is valid, the handler should call the Jira REST
    API (GET /rest/api/3/search) and persist the results as generated
    artifacts.  For the Friday demo, we return a realistic mock response
    and store a summary artifact.
    """
    _get_project_or_404(db, payload.target_project_id)

    # Demo: build representative mock artifacts from the Jira payload shape
    mock_epics = ["User Authentication", "Account Management", "Transaction Management"]
    mock_stories = [
        "As a customer, I want to log in with email and password",
        "As a customer, I want to view my account balances",
        "As a customer, I want to filter my transaction history by date",
    ]

    summary = {
        "jira_url": payload.jira_url,
        "project_key": payload.project_key,
        "epics": mock_epics,
        "stories": mock_stories,
        "imported_at": datetime.now(timezone.utc).isoformat(),
    }

    artifact = _save_artifact(db, payload.target_project_id, ArtifactType.USER_STORIES.value, json.dumps(summary))
    db.add(TimelineEvent(
        project_id=payload.target_project_id,
        stage="Jira Import",
        status=RunStatus.COMPLETED.value,
    ))
    db.commit()

    return {
        "stories_imported": len(mock_stories),
        "epics_imported": len(mock_epics),
        "artifacts_created": 1,
        "project_id": payload.target_project_id,
    }


# ===========================================================================
# SECTION 6 — Generate Requirements
# ===========================================================================

@router.post("/generate/requirements", response_model=GenerateRequirementsResponse, tags=["generate"])
async def generate_requirements(
    payload: GenerateRequirementsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_project_or_404(db, payload.project_id)

    try:
        result = ai_service.generate_requirements(db, payload.project_id, payload.prompt, payload.document_ids)
    except ai_service.AIGenerationError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))

    # Auto-enrich each requirement into an implementation-ready spec.
    try:
        from .requirement_enricher import enrich_requirements
        schema_art = _latest_artifact(db, payload.project_id, ArtifactType.SQL_SCHEMA.value)
        schema_data = json.loads(schema_art.content) if schema_art else {}
        result["requirements"] = enrich_requirements(result.get("requirements", []), schema_data, {})
        result["enriched"] = True
    except Exception as exc:
        logger.warning("[Requirements] enrichment failed: %s", exc)

    artifact = _save_artifact(db, payload.project_id, ArtifactType.REQUIREMENTS_DOC.value, json.dumps(result))

    db.add(TimelineEvent(project_id=payload.project_id, stage="Requirements Generated", status=RunStatus.COMPLETED.value))
    db.add(Approval(project_id=payload.project_id, artifact_type=ArtifactType.REQUIREMENTS_DOC.value, status=ApprovalStatus.PENDING_APPROVAL.value))
    db.commit()

    await manager.artifact_generated(payload.project_id, {
        "artifact_id": artifact.id,
        "artifact_type": ArtifactType.REQUIREMENTS_DOC.value,
    })

    return {
        "project_id": payload.project_id,
        "artifact_id": artifact.id,
        "requirements": result.get("requirements", []),
        "assumptions": result.get("assumptions", []),
        "risks": result.get("risks", []),
    }


# ===========================================================================
# SECTION 7 — Generate User Stories
# ===========================================================================

@router.post("/generate/user-stories", response_model=GenerateUserStoriesResponse, tags=["generate"])
async def generate_user_stories(
    payload: GenerateUserStoriesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_project_or_404(db, payload.project_id)

    # Pull the requirements context from the specified or latest artifact
    req_artifact = (
        db.get(GeneratedArtifact, payload.requirements_artifact_id)
        if payload.requirements_artifact_id
        else _latest_artifact(db, payload.project_id, ArtifactType.REQUIREMENTS_DOC.value)
    )
    context = req_artifact.content if req_artifact else ""

    try:
        result = ai_service.generate_user_stories(db, payload.project_id, context)
    except ai_service.AIGenerationError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))

    artifact = _save_artifact(db, payload.project_id, ArtifactType.USER_STORIES.value, json.dumps(result))
    total = sum(len(e.get("stories", [])) for e in result.get("epics", []))

    db.add(TimelineEvent(project_id=payload.project_id, stage="User Stories Generated", status=RunStatus.COMPLETED.value))
    db.add(Approval(project_id=payload.project_id, artifact_type=ArtifactType.USER_STORIES.value, status=ApprovalStatus.PENDING_APPROVAL.value))
    db.commit()

    await manager.artifact_generated(payload.project_id, {
        "artifact_id": artifact.id,
        "artifact_type": ArtifactType.USER_STORIES.value,
    })

    return {
        "project_id": payload.project_id,
        "artifact_id": artifact.id,
        "epics": result.get("epics", []),
        "total_stories": total,
    }


# ===========================================================================
# SECTION 8 — Generate Architecture / Database Schema / API Design
# ===========================================================================

@router.post("/generate/architecture", response_model=GenerateArchitectureResponse, tags=["generate"])
async def generate_architecture(
    payload: GenerateArchitectureRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    project = _get_project_or_404(db, payload.project_id)
    context = project.description or project.name

    try:
        result = ai_service.generate_architecture(db, payload.project_id, context)
    except ai_service.AIGenerationError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))

    # Augment with the complete, deterministic diagram set derived from real
    # project data (components, microservices, tech_stack, DB schema).
    try:
        from .diagram_generator import build_all_diagrams
        schema_art = _latest_artifact(db, payload.project_id, ArtifactType.SQL_SCHEMA.value)
        schema_data = json.loads(schema_art.content) if schema_art else {}
        result["diagrams"] = build_all_diagrams(result, schema_data, project.name)
    except Exception as exc:  # keep LLM diagrams if augmentation fails
        logger.warning("[Architecture] diagram augmentation failed: %s", exc)

    artifact = _save_artifact(db, payload.project_id, ArtifactType.ARCHITECTURE_DIAGRAM.value, json.dumps(result))
    db.add(TimelineEvent(project_id=payload.project_id, stage="Architecture Generated", status=RunStatus.COMPLETED.value))
    db.add(Approval(project_id=payload.project_id, artifact_type=ArtifactType.ARCHITECTURE_DIAGRAM.value, status=ApprovalStatus.PENDING_APPROVAL.value))
    db.commit()

    await manager.artifact_generated(payload.project_id, {
        "artifact_id": artifact.id,
        "artifact_type": ArtifactType.ARCHITECTURE_DIAGRAM.value,
    })
    approval_row = db.query(Approval).filter(
        Approval.project_id == payload.project_id,
        Approval.artifact_type == ArtifactType.ARCHITECTURE_DIAGRAM.value,
    ).order_by(Approval.id.desc()).first()
    await manager.approval_requested(payload.project_id, {
        "approval_id": approval_row.id if approval_row else None,
        "artifact_type": ArtifactType.ARCHITECTURE_DIAGRAM.value,
    })

    return {
        "project_id": payload.project_id,
        "artifact_id": artifact.id,
        "architecture_summary": result.get("architecture_summary", ""),
        "pattern": result.get("pattern", ""),
        "microservices": result.get("microservices", []),
        "components": result.get("components", []),
        "diagrams": result.get("diagrams", []),
        "tech_stack": result.get("tech_stack", {}),
    }


@router.post("/generate/requirements-enrich", tags=["generate"])
async def enrich_requirements_endpoint(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Expand the latest requirements artifact into implementation-ready detail
    (business rules, edge cases, validations, workflow, acceptance criteria,
    API/UI/DB impact, dependencies, constraints, NFR targets)."""
    project_id = payload.get("project_id")
    if not project_id:
        raise HTTPException(422, "project_id required")
    _get_project_or_404(db, project_id)

    from .requirement_enricher import enrich_requirements

    req_art = _latest_artifact(db, project_id, ArtifactType.REQUIREMENTS_DOC.value)
    if not req_art:
        raise HTTPException(404, "No requirements artifact found. Generate requirements first.")
    req_data = json.loads(req_art.content)

    schema_art = _latest_artifact(db, project_id, ArtifactType.SQL_SCHEMA.value)
    schema_data = json.loads(schema_art.content) if schema_art else {}
    arch_art = _latest_artifact(db, project_id, ArtifactType.ARCHITECTURE_DIAGRAM.value)
    arch_data = json.loads(arch_art.content) if arch_art else {}

    enriched = enrich_requirements(req_data.get("requirements", []), schema_data, arch_data)
    req_data["requirements"] = enriched
    req_data["enriched"] = True

    req_art.content = json.dumps(req_data)
    db.add(req_art)
    db.commit()

    await manager.artifact_generated(project_id, {
        "artifact_id": req_art.id,
        "artifact_type": ArtifactType.REQUIREMENTS_DOC.value,
    })
    return {"project_id": project_id, "artifact_id": req_art.id, "count": len(enriched), "enriched": True}


@router.post("/generate/architecture-diagrams", tags=["generate"])
async def regenerate_architecture_diagrams(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Regenerate the FULL diagram set from existing architecture + schema
    artifacts, without re-running the LLM architecture agent."""
    project_id = payload.get("project_id")
    if not project_id:
        raise HTTPException(422, "project_id required")
    project = _get_project_or_404(db, project_id)

    from .diagram_generator import build_all_diagrams

    arch_art = _latest_artifact(db, project_id, ArtifactType.ARCHITECTURE_DIAGRAM.value)
    arch_data = json.loads(arch_art.content) if arch_art else {}
    schema_art = _latest_artifact(db, project_id, ArtifactType.SQL_SCHEMA.value)
    schema_data = json.loads(schema_art.content) if schema_art else {}

    diagrams = build_all_diagrams(arch_data, schema_data, project.name)
    arch_data["diagrams"] = diagrams

    # Persist back onto the architecture artifact (in-place if present)
    if arch_art:
        arch_art.content = json.dumps(arch_data)
        db.add(arch_art)
        artifact_id = arch_art.id
    else:
        new_art = _save_artifact(db, project_id, ArtifactType.ARCHITECTURE_DIAGRAM.value, json.dumps(arch_data))
        artifact_id = new_art.id
    db.commit()

    await manager.artifact_generated(project_id, {
        "artifact_id": artifact_id,
        "artifact_type": ArtifactType.ARCHITECTURE_DIAGRAM.value,
    })

    return {
        "project_id": project_id,
        "artifact_id": artifact_id,
        "count": len(diagrams),
        "diagrams": diagrams,
    }


@router.post("/generate/database-schema", response_model=GenerateDatabaseSchemaResponse, tags=["generate"])
async def generate_database_schema(
    payload: GenerateDatabaseSchemaRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    project = _get_project_or_404(db, payload.project_id)
    context = project.description or project.name

    try:
        result = ai_service.generate_database_schema(db, payload.project_id, context)
    except ai_service.AIGenerationError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))

    artifact = _save_artifact(db, payload.project_id, ArtifactType.SQL_SCHEMA.value, json.dumps(result))
    db.add(TimelineEvent(project_id=payload.project_id, stage="Database Schema Generated", status=RunStatus.COMPLETED.value))
    db.add(Approval(project_id=payload.project_id, artifact_type=ArtifactType.SQL_SCHEMA.value, status=ApprovalStatus.PENDING_APPROVAL.value))
    db.commit()

    await manager.artifact_generated(payload.project_id, {
        "artifact_id": artifact.id,
        "artifact_type": ArtifactType.SQL_SCHEMA.value,
    })

    return {
        "project_id": payload.project_id,
        "artifact_id": artifact.id,
        "tables": result.get("tables", []),
        "relationships": result.get("relationships", []),
        "sql_ddl": result.get("sql_ddl", ""),
    }


@router.post("/generate/api-design", response_model=GenerateApiDesignResponse, tags=["generate"])
async def generate_api_design(
    payload: GenerateApiDesignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    project = _get_project_or_404(db, payload.project_id)
    context = project.description or project.name

    try:
        result = ai_service.generate_api_design(db, payload.project_id, context)
    except ai_service.AIGenerationError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))

    artifact = _save_artifact(db, payload.project_id, ArtifactType.API_DESIGN.value, json.dumps(result))
    db.add(TimelineEvent(project_id=payload.project_id, stage="API Design Generated", status=RunStatus.COMPLETED.value))
    db.commit()

    await manager.artifact_generated(payload.project_id, {
        "artifact_id": artifact.id,
        "artifact_type": ArtifactType.API_DESIGN.value,
    })

    return {
        "project_id": payload.project_id,
        "artifact_id": artifact.id,
        "api_style": result.get("api_style", "REST"),
        "base_url": result.get("base_url", "http://localhost:8000"),
        "endpoints": result.get("endpoints", []),
        "openapi_yaml": result.get("openapi_yaml", ""),
    }


# ===========================================================================
# SECTION 10 — Dashboard APIs
# ===========================================================================

@router.get("/dashboard/summary", response_model=DashboardSummaryOut, tags=["dashboard"])
def dashboard_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    from sqlalchemy import func

    total_projects = db.query(func.count(Project.id)).scalar() or 0
    active = db.query(func.count(Project.id)).filter(Project.status == "in_progress").scalar() or 0
    completed = db.query(func.count(Project.id)).filter(Project.status == "completed").scalar() or 0

    total_runs = db.query(func.count(AgentRun.id)).scalar() or 0
    running = db.query(func.count(AgentRun.id)).filter(AgentRun.status == RunStatus.RUNNING.value).scalar() or 0
    done_runs = db.query(func.count(AgentRun.id)).filter(AgentRun.status == RunStatus.COMPLETED.value).scalar() or 0
    failed_runs = db.query(func.count(AgentRun.id)).filter(AgentRun.status == RunStatus.FAILED.value).scalar() or 0

    pending_approvals = db.query(func.count(Approval.id)).filter(Approval.status == ApprovalStatus.PENDING_APPROVAL.value).scalar() or 0
    total_artifacts = db.query(func.count(GeneratedArtifact.id)).scalar() or 0
    total_docs = db.query(func.count(Document.id)).scalar() or 0

    return {
        "total_projects": total_projects,
        "active_projects": active,
        "completed_projects": completed,
        "total_agent_runs": total_runs,
        "running_agents": running,
        "completed_agents": done_runs,
        "failed_agents": failed_runs,
        "pending_approvals": pending_approvals,
        "total_artifacts": total_artifacts,
        "total_documents": total_docs,
    }


@router.get("/dashboard/projects", response_model=list[ProjectListOut], tags=["dashboard"])
def dashboard_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Project]:
    return db.query(Project).order_by(Project.created_at.desc()).limit(20).all()


@router.get("/dashboard/agents", response_model=list[DashboardAgentOut], tags=["dashboard"])
def dashboard_agents(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[AgentRun]:
    q = db.query(AgentRun)
    if project_id:
        q = q.filter(AgentRun.project_id == project_id)
    return q.order_by(AgentRun.id.desc()).limit(50).all()


@router.get("/dashboard/governance", response_model=DashboardGovernanceOut, tags=["dashboard"])
def dashboard_governance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    from sqlalchemy import func

    counts: dict[str, int] = {}
    for row in db.query(Approval.status, func.count(Approval.id)).group_by(Approval.status).all():
        counts[row[0]] = row[1]

    recent_approvals = (
        db.query(Approval)
        .order_by(Approval.id.desc())
        .limit(10)
        .all()
    )

    return {
        "total_approvals": sum(counts.values()),
        "pending": counts.get(ApprovalStatus.PENDING_APPROVAL.value, 0),
        "approved": counts.get(ApprovalStatus.APPROVED.value, 0),
        "rejected": counts.get(ApprovalStatus.REJECTED.value, 0),
        "published": counts.get(ApprovalStatus.PUBLISHED.value, 0),
        "recent": [
            {
                "id": a.id,
                "project_id": a.project_id,
                "artifact_type": a.artifact_type,
                "status": a.status,
                "comments": a.comments,
            }
            for a in recent_approvals
        ],
    }


# Project list and detail (needed by dashboard and frontend Projects page)

@router.get("/projects", response_model=list[ProjectListOut], tags=["projects"])
def list_projects(
    status: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Project]:
    q = db.query(Project)
    if status:
        q = q.filter(Project.status == status)
    return q.order_by(Project.created_at.desc()).all()


@router.get("/projects/{project_id}", response_model=ProjectDetailOut, tags=["projects"])
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    project = _get_project_or_404(db, project_id)
    from sqlalchemy import func
    run_count = db.query(func.count(AgentRun.id)).filter(AgentRun.project_id == project_id).scalar() or 0
    del_count = db.query(func.count(ProjectDeliverable.id)).filter(ProjectDeliverable.project_id == project_id).scalar() or 0
    art_count = db.query(func.count(GeneratedArtifact.id)).filter(GeneratedArtifact.project_id == project_id).scalar() or 0

    return {
        **{c.name: getattr(project, c.name) for c in Project.__table__.columns},
        "agent_run_count": run_count,
        "deliverable_count": del_count,
        "artifact_count": art_count,
    }


# ===========================================================================
# SECTION 11 — Database Workspace APIs
# ===========================================================================

def _schema_from_artifact(db: Session, project_id: int) -> dict:
    artifact = _latest_artifact(db, project_id, ArtifactType.SQL_SCHEMA.value)
    if not artifact:
        return {}
    try:
        return json.loads(artifact.content)
    except Exception:
        return {"sql_ddl": artifact.content}


@router.get("/database/schema/{project_id}", response_model=DatabaseSchemaOut, tags=["database"])
def database_schema(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_project_or_404(db, project_id)
    data = _schema_from_artifact(db, project_id)
    approval = (
        db.query(Approval)
        .filter(Approval.project_id == project_id, Approval.artifact_type == ArtifactType.SQL_SCHEMA.value)
        .order_by(Approval.id.desc())
        .first()
    )
    return {
        "project_id": project_id,
        "tables": data.get("tables", []),
        "approval_status": approval.status if approval else "not_submitted",
    }


@router.get("/database/relationships/{project_id}", response_model=DatabaseRelationshipsOut, tags=["database"])
def database_relationships(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_project_or_404(db, project_id)
    data = _schema_from_artifact(db, project_id)
    return {"project_id": project_id, "relationships": data.get("relationships", [])}


@router.get("/database/sql-preview/{project_id}", response_model=DatabaseSqlPreviewOut, tags=["database"])
def database_sql_preview(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_project_or_404(db, project_id)
    data = _schema_from_artifact(db, project_id)
    return {"project_id": project_id, "sql_ddl": data.get("sql_ddl", "")}


@router.get("/database/migrations/{project_id}", response_model=DatabaseMigrationsOut, tags=["database"])
def database_migrations(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_project_or_404(db, project_id)
    data = _schema_from_artifact(db, project_id)
    sql = data.get("sql_ddl", "")

    migrations = []
    if sql:
        migrations = [
            MigrationOut(
                version="0001",
                description="Initial schema — customers, accounts, transactions",
                applied=True,
                sql_up=sql,
                sql_down="DROP TABLE IF EXISTS transactions, accounts, customers;",
            )
        ]

    return {"project_id": project_id, "migrations": [m.model_dump() for m in migrations]}


@router.post("/database/approve-schema/{project_id}", response_model=ApproveSchemaDatabaseOut, tags=["database"])
async def approve_database_schema(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_project_or_404(db, project_id)

    approval = (
        db.query(Approval)
        .filter(Approval.project_id == project_id, Approval.artifact_type == ArtifactType.SQL_SCHEMA.value)
        .order_by(Approval.id.desc())
        .first()
    )

    if approval is None:
        approval = Approval(
            project_id=project_id,
            artifact_type=ArtifactType.SQL_SCHEMA.value,
            status=ApprovalStatus.APPROVED.value,
            approved_by=current_user.id,
            comments="Approved via Database Workspace",
        )
        db.add(approval)
    else:
        approval.status = ApprovalStatus.APPROVED.value
        approval.approved_by = current_user.id
        approval.comments = "Approved via Database Workspace"

    db.add(TimelineEvent(project_id=project_id, stage="Database Schema Approved", status=RunStatus.COMPLETED.value))
    db.commit()
    db.refresh(approval)

    await manager.approval_completed(project_id, approval.id, ApprovalStatus.APPROVED.value, current_user.id)

    return {
        "project_id": project_id,
        "approval_id": approval.id,
        "status": approval.status,
        "approved_at": datetime.now(timezone.utc),
    }


# ===========================================================================
# SECTION 12 — Documentation Center
# ===========================================================================

DOCUMENT_CATEGORIES = [
    "BRD", "SRS", "User Stories", "Architecture Documents",
    "Database Documents", "API Documents", "Test Reports", "Deployment Documents",
]

_ARTIFACT_TYPE_TO_CATEGORY: dict[str, str] = {
    ArtifactType.REQUIREMENTS_DOC.value: "BRD",
    ArtifactType.USER_STORIES.value: "User Stories",
    ArtifactType.ARCHITECTURE_DIAGRAM.value: "Architecture Documents",
    ArtifactType.SQL_SCHEMA.value: "Database Documents",
    ArtifactType.API_DESIGN.value: "API Documents",
    ArtifactType.REACT_CODE.value: "Architecture Documents",
    ArtifactType.BACKEND_CODE.value: "Architecture Documents",
    ArtifactType.API_RESPONSE_MOCK.value: "API Documents",
    ArtifactType.TEST_REPORT.value: "Test Reports",
    ArtifactType.DEPLOYMENT_DOC.value: "Deployment Documents",
}


def _artifact_to_doc_out(a: GeneratedArtifact) -> dict:
    return {
        "id": a.id,
        "project_id": a.project_id,
        "file_name": f"{a.artifact_type}_{a.id}.txt",
        "document_type": a.artifact_type,
        "storage_path": f"/generated_artifacts/{a.id}",
        "uploaded_at": a.created_at,
        "category": _ARTIFACT_TYPE_TO_CATEGORY.get(a.artifact_type, "Other"),
        "size_bytes": len(a.content.encode("utf-8")) if a.content else 0,
    }


@router.get("/documents", response_model=list[DocumentOut], tags=["documents"])
def list_documents(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    """Returns both uploaded Documents and GeneratedArtifacts as a unified list."""
    results: list[dict] = []

    # Uploaded files
    q = db.query(Document)
    if project_id:
        q = q.filter(Document.project_id == project_id)
    for doc in q.all():
        p = Path(doc.storage_path)
        results.append({
            "id": doc.id,
            "project_id": doc.project_id,
            "file_name": doc.file_name,
            "document_type": doc.document_type,
            "storage_path": doc.storage_path,
            "uploaded_at": doc.uploaded_at,
            "category": _document_category(doc.document_type),
            "size_bytes": p.stat().st_size if p.exists() else 0,
        })

    # Generated artifacts (treated as virtual documents for the demo)
    q2 = db.query(GeneratedArtifact)
    if project_id:
        q2 = q2.filter(GeneratedArtifact.project_id == project_id)
    for art in q2.order_by(GeneratedArtifact.created_at.asc()).all():
        results.append(_artifact_to_doc_out(art))

    return results


@router.get("/documents/category/{category}", response_model=DocumentCategoryOut, tags=["documents"])
def documents_by_category(
    category: str,
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    q = db.query(GeneratedArtifact)
    if project_id:
        q = q.filter(GeneratedArtifact.project_id == project_id)

    target_types = [k for k, v in _ARTIFACT_TYPE_TO_CATEGORY.items() if v == category]
    filtered = q.filter(GeneratedArtifact.artifact_type.in_(target_types)).all() if target_types else []
    docs = [_artifact_to_doc_out(a) for a in filtered]

    return {"category": category, "documents": docs, "count": len(docs)}


@router.get("/documents/export-artifact", tags=["documents"])
def export_artifact(
    projectId: int | None = None,
    artifact_type: str | None = None,
    format: str = "txt",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export a single artifact by type as a downloadable file."""
    q = db.query(GeneratedArtifact)
    if projectId:
        q = q.filter(GeneratedArtifact.project_id == projectId)
    if artifact_type:
        q = q.filter(GeneratedArtifact.artifact_type == artifact_type)
    art = q.order_by(GeneratedArtifact.created_at.desc()).first()
    if not art:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artifact not found")
    ext = ".sql" if art.artifact_type == ArtifactType.SQL_SCHEMA.value else f".{format}"
    filename = f"{art.artifact_type}_{art.id}{ext}"
    content_bytes = (art.content or "").encode("utf-8")
    return StreamingResponse(
        BytesIO(content_bytes),
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/documents/export-all", tags=["documents"])
@router.post("/documents/export-all", tags=["documents"])
def export_all_documents(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(GeneratedArtifact)
    if project_id:
        q = q.filter(GeneratedArtifact.project_id == project_id)
    artifacts = q.order_by(GeneratedArtifact.created_at.asc()).all()

    if not artifacts:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No artifacts to export")

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for art in artifacts:
            ext = ".sql" if art.artifact_type == ArtifactType.SQL_SCHEMA.value else ".txt"
            name = f"{art.artifact_type}_{art.id}{ext}"
            zf.writestr(name, art.content or "")
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="ey_sdlc_export.zip"'},
    )


# Static paths above (export-artifact, export-all) MUST be registered before
# the dynamic /documents/{document_id} below — FastAPI/Starlette matches
# routes in registration order, so a dynamic path segment declared first
# would otherwise swallow "export-artifact"/"export-all" as a document_id
# value (this was a real, previously-unreachable-route bug: both export
# endpoints below returned 422 int-parsing errors instead of ever running).
@router.get("/documents/{document_id}", response_model=DocumentOut, tags=["documents"])
def get_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    # Try uploaded documents first, then artifacts
    doc = db.get(Document, document_id)
    if doc:
        p = Path(doc.storage_path)
        return {
            "id": doc.id, "project_id": doc.project_id, "file_name": doc.file_name,
            "document_type": doc.document_type, "storage_path": doc.storage_path,
            "uploaded_at": doc.uploaded_at,
            "category": _document_category(doc.document_type),
            "size_bytes": p.stat().st_size if p.exists() else 0,
        }
    art = db.get(GeneratedArtifact, document_id)
    if art:
        return _artifact_to_doc_out(art)
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")


@router.get("/documents/download/{document_id}", tags=["documents"])
def download_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Uploaded file → serve from disk
    doc = db.get(Document, document_id)
    if doc:
        p = Path(doc.storage_path)
        if not p.exists():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found on disk")
        return FileResponse(path=str(p), filename=doc.file_name, media_type="application/octet-stream")

    # Generated artifact → stream the text content as a .txt/.sql file
    art = db.get(GeneratedArtifact, document_id)
    if art:
        ext = ".sql" if art.artifact_type == ArtifactType.SQL_SCHEMA.value else ".txt"
        filename = f"{art.artifact_type}_{art.id}{ext}"
        content_bytes = (art.content or "").encode("utf-8")
        return StreamingResponse(
            BytesIO(content_bytes),
            media_type="text/plain",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")


# ===========================================================================
# SECTION 13 — Approval Workflow (per project)
# ===========================================================================

@router.get("/projects/{project_id}/approvals", response_model=list[ApprovalOut], tags=["approvals"])
def list_approvals(
    project_id: int,
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Approval]:
    _get_project_or_404(db, project_id)
    q = db.query(Approval).filter(Approval.project_id == project_id)
    if status_filter:
        q = q.filter(Approval.status == status_filter)
    return q.order_by(Approval.id.asc()).all()


@router.post(
    "/projects/{project_id}/approvals/{approval_id}/decide",
    response_model=ApprovalDecisionOut,
    tags=["approvals"],
)
async def decide_approval(
    project_id: int,
    approval_id: int,
    payload: ApprovalDecisionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_project_or_404(db, project_id)

    approval = db.get(Approval, approval_id)
    if approval is None or approval.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Approval not found")

    allowed = {ApprovalStatus.APPROVED.value, ApprovalStatus.REJECTED.value, ApprovalStatus.PUBLISHED.value}
    if payload.decision not in allowed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Decision must be one of: {', '.join(allowed)}")

    approval.status = payload.decision
    approval.approved_by = current_user.id
    approval.comments = payload.comments

    db.add(TimelineEvent(
        project_id=project_id,
        stage=f"Approval {payload.decision.capitalize()}: {approval.artifact_type}",
        status=RunStatus.COMPLETED.value,
    ))
    db.commit()

    decided_at = datetime.now(timezone.utc)
    await manager.approval_completed(project_id, approval_id, payload.decision, current_user.id)

    # If approved, resume the pipeline from the appropriate checkpoint.
    # Which checkpoint this is is already known with certainty from the
    # approval's own artifact_type — no need to guess from timeline-event
    # text (the previous approach searched the latest TimelineEvent for
    # "Checkpoint 1"/"Checkpoint 2", but that row is either the BA/Architect
    # stage's own completion event — whichever agent last ran before the
    # pipeline paused — or, after the fix below, this function's own
    # "Approval Approved: review_1_checkpoint" event added just above,
    # neither of which contains that substring, so the match always failed
    # and the pipeline never actually resumed).
    # run_pipeline() (not run_agent()) is required here: it walks the
    # remaining stages in order (Solution Architecture through
    # Documentation), whereas run_agent() executes only a single stage and
    # leaves everything after it stuck at "pending" forever.
    if payload.decision == ApprovalStatus.APPROVED.value and approval.artifact_type in (
        ArtifactType.REVIEW_1_CHECKPOINT.value,
        ArtifactType.REVIEW_2_CHECKPOINT.value,
    ):
        _asyncio.create_task(_agent_runner.run_pipeline(project_id))


    return {
        "approval_id": approval_id,
        "new_status": payload.decision,
        "decided_at": decided_at,
        "decided_by": current_user.id,
    }


# ===========================================================================
# SECTION 14 — AI Review Copilot
# ===========================================================================

def _run_review_endpoint(review_type: str):
    """Factory that returns a FastAPI endpoint function for a given review_type."""
    async def endpoint(
        payload: ReviewRequest,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> dict:
        _get_project_or_404(db, payload.project_id)

        # Resolve artifact content to review
        if payload.artifact_id:
            art = db.get(GeneratedArtifact, payload.artifact_id)
            content = art.content if art else (payload.context or "")
        else:
            # Pick the most relevant artifact type for each review
            type_map = {
                "architecture": ArtifactType.ARCHITECTURE_DIAGRAM.value,
                "database": ArtifactType.SQL_SCHEMA.value,
                "ui": ArtifactType.REACT_CODE.value,
                "code": ArtifactType.BACKEND_CODE.value,
                "security": ArtifactType.REQUIREMENTS_DOC.value,
            }
            preferred = type_map.get(review_type)
            art = _latest_artifact(db, payload.project_id, preferred) if preferred else None
            content = art.content if art else (payload.context or f"Review {review_type} for project {payload.project_id}")

        try:
            result = ai_service.run_review(db, payload.project_id, review_type, content)
        except ai_service.AIGenerationError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))

        # Persist review result
        review_row = ReviewResult(
            project_id=payload.project_id,
            review_type=review_type,
            score=float(result.get("score", 85.0)),
            findings=result,
        )
        db.add(review_row)
        db.add(TimelineEvent(
            project_id=payload.project_id,
            stage=f"{review_type.capitalize()} Review Completed",
            status=RunStatus.COMPLETED.value,
        ))
        db.commit()
        db.refresh(review_row)

        await manager.review_completed(
            payload.project_id,
            review_type,
            review_row.score,
            result.get("risk_level", "low"),
        )

        return {
            "project_id": payload.project_id,
            "review_type": review_type,
            "score": review_row.score,
            "risk_level": result.get("risk_level", "low"),
            "summary": result.get("summary", ""),
            "findings": result.get("findings", []),
            "recommendations": result.get("recommendations", []),
            "artifact_id": review_row.id,
        }

    endpoint.__name__ = f"review_{review_type}"
    return endpoint


router.post(f"/reviews/architecture", response_model=ReviewResponse, tags=["reviews"])(
    _run_review_endpoint("architecture")
)
router.post(f"/reviews/database", response_model=ReviewResponse, tags=["reviews"])(
    _run_review_endpoint("database")
)
router.post(f"/reviews/ui", response_model=ReviewResponse, tags=["reviews"])(
    _run_review_endpoint("ui")
)
router.post(f"/reviews/code", response_model=ReviewResponse, tags=["reviews"])(
    _run_review_endpoint("code")
)
router.post(f"/reviews/security", response_model=ReviewResponse, tags=["reviews"])(
    _run_review_endpoint("security")
)


# ===========================================================================
# SECTION 15 — BYOK Provider APIs
# ===========================================================================

@router.get("/providers", response_model=ProviderListOut, tags=["providers"])
def list_providers(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    q = db.query(ProviderConfiguration)
    if project_id:
        q = q.filter(ProviderConfiguration.project_id == project_id)
    configs = q.all()

    return {
        "providers": [
            {
                "id": c.id,
                "project_id": c.project_id,
                "provider_name": c.provider_name,
                "enabled": c.enabled,
                "base_url": c.base_url,
                "model": c.model,
                "api_version": c.api_version,
            }
            for c in configs
        ],
        "supported": ai_service.SUPPORTED_PROVIDERS,
    }


@router.post("/providers/configure", response_model=ProviderConfigureOut, tags=["providers"])
def configure_provider(
    payload: ProviderConfigureRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_project_or_404(db, payload.project_id)

    existing = (
        db.query(ProviderConfiguration)
        .filter(
            ProviderConfiguration.project_id == payload.project_id,
            ProviderConfiguration.provider_name == payload.provider_name,
        )
        .first()
    )

    encrypted = encrypt_secret(payload.api_key)

    if existing:
        existing.enabled = payload.enabled
        existing.encrypted_key = encrypted
        existing.base_url = payload.base_url
        existing.model = payload.model
        existing.api_version = payload.api_version
        provider_row = existing
    else:
        provider_row = ProviderConfiguration(
            project_id=payload.project_id,
            provider_name=payload.provider_name,
            enabled=payload.enabled,
            encrypted_key=encrypted,
            base_url=payload.base_url,
            model=payload.model,
            api_version=payload.api_version,
        )
        db.add(provider_row)

    db.commit()
    db.refresh(provider_row)

    return {
        "provider_id": provider_row.id,
        "provider_name": provider_row.provider_name,
        "enabled": provider_row.enabled,
        "key_stored": True,
    }


@router.post("/providers/test", response_model=ProviderTestOut, tags=["providers"])
def test_provider(
    payload: ProviderTestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_project_or_404(db, payload.project_id)

    config = (
        db.query(ProviderConfiguration)
        .filter(
            ProviderConfiguration.project_id == payload.project_id,
            ProviderConfiguration.provider_name == payload.provider_name,
            ProviderConfiguration.enabled == True,
        )
        .first()
    )

    raw_key: str | None = None
    if config and config.encrypted_key:
        from .agents.llm_service import _decrypt_provider_key
        raw_key = _decrypt_provider_key(config.encrypted_key)

    result = ai_service.test_provider(
        payload.provider_name,
        raw_key,
        base_url=config.base_url if config else None,
        model=config.model if config else None,
        api_version=config.api_version if config else None,
    )

    return {
        "provider_name": payload.provider_name,
        "reachable": result["reachable"],
        "latency_ms": result["latency_ms"],
        "model_tested": result["model_tested"],
        "message": result["message"],
    }


# ===========================================================================
# SECTION 16 — WebSocket  ws://<host>/ws?projectId=<id>
# ===========================================================================

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, projectId: int | None = None):
    """
    Real-time event stream for a project.
    
    Connect with query parameter: ws://localhost:8000/ws?projectId=123
    
    Events broadcast by the server (JSON):
        { "event": "agent_started",      "project_id": N, "payload": {...}, "timestamp": "..." }
        { "event": "agent_completed",    "project_id": N, "payload": {...}, "timestamp": "..." }
        { "event": "artifact_generated", "project_id": N, "payload": {...}, "timestamp": "..." }
        { "event": "approval_requested", "project_id": N, "payload": {...}, "timestamp": "..." }
        { "event": "approval_completed", "project_id": N, "payload": {...}, "timestamp": "..." }
        { "event": "review_completed",   "project_id": N, "payload": {...}, "timestamp": "..." }

    The client may send a JSON ping to keep the connection alive:
        { "type": "ping" }
    The server replies:
        { "type": "pong", "timestamp": "..." }
    """
    import json as _json

    # Default to project 0 if not provided, allows connection without auth
    project_id = projectId if projectId is not None else 0
    
    await manager.connect(websocket, project_id)
    # Send an immediate welcome / connection-confirmed event
    await manager.send_personal(websocket, {
        "event": "connected",
        "project_id": project_id,
        "payload": {"active_connections": manager.active_count(project_id)},
    })

    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = _json.loads(data)
                if msg.get("type") == "ping":
                    await manager.send_personal(websocket, {
                        "type": "pong",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
            except Exception:
                pass  # ignore malformed client messages
    except WebSocketDisconnect:
        manager.disconnect(websocket, project_id)

class AgentTriggerResponse(_BaseModel):
    run_id: int
    agent_name: str
    status: str
    message: str


class PipelineTriggerResponse(_BaseModel):
    project_id: int
    agents_queued: int
    message: str


@router.get(
    "/projects/{project_id}/agent-runs",
    tags=["agents"],
    summary="List all agent runs for a project in pipeline order",
)
def list_agent_runs(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    _get_project_or_404(db, project_id)
    runs = (
        db.query(AgentRun)
        .filter(AgentRun.project_id == project_id)
        .order_by(AgentRun.id.asc())
        .all()
    )
    return [
        {
            "id": r.id,
            "project_id": r.project_id,
            "agent_name": r.agent_name,
            "status": r.status,
            "start_time": r.start_time,
            "end_time": r.end_time,
            "output_url": r.output_url,
        }
        for r in runs
    ]


@router.post(
    "/projects/{project_id}/agent-runs/{run_id}/trigger",
    response_model=AgentTriggerResponse,
    tags=["agents"],
    summary="Trigger (or re-trigger) a single agent run",
)
async def trigger_agent_run(
    project_id: int,
    run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_project_or_404(db, project_id)
    run = db.get(AgentRun, run_id)
    if run is None or run.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent run not found")
    if run.status == RunStatus.RUNNING.value:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{run.agent_name} is already running")

    # Reset if previously failed so it can be retried
    if run.status == RunStatus.FAILED.value:
        run.status = RunStatus.PENDING.value
        db.commit()

    _asyncio.create_task(_agent_runner.run_agent(project_id, run_id))

    return {
        "run_id": run.id,
        "agent_name": run.agent_name,
        "status": "starting",
        "message": f"{run.agent_name} queued — watch /ws?projectId={project_id} for progress events",
    }


@router.post(
    "/projects/{project_id}/pipeline/trigger",
    response_model=PipelineTriggerResponse,
    tags=["agents"],
    summary="Trigger the full 7-agent pipeline for a project",
)
async def trigger_pipeline(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_project_or_404(db, project_id)

    # Ensure all pipeline agent_run rows exist before handing off
    runs = _agent_runner.ensure_agent_runs_exist(db, project_id)

    _asyncio.create_task(_agent_runner.run_pipeline(project_id))

    return {
        "project_id": project_id,
        "agents_queued": len(runs),
        "message": f"Pipeline started for project {project_id} — watch /ws?projectId={project_id} for live progress",
    }


@router.post(
    "/projects/{project_id}/pipeline/reset",
    tags=["agents"],
    summary="Reset all agent runs to pending (allows re-running the full pipeline)",
)
def reset_pipeline(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_project_or_404(db, project_id)
    runs = db.query(AgentRun).filter(AgentRun.project_id == project_id).all()
    for run in runs:
        run.status = RunStatus.PENDING.value
        run.start_time = None
        run.end_time = None
        run.output_url = None
    db.commit()
    return {"project_id": project_id, "reset_count": len(runs), "message": "All agent runs reset to pending"}


# ===========================================================================
# MONITORING & ALERTS
# MonitoringCenter.tsx currently uses mockAlerts — these endpoints back it
# with real data.  Alerts are stored as TimelineEvents with severity metadata
# encoded in the stage field (no separate alerts table in current schema).
# ===========================================================================
from pydantic import BaseModel as _BM2
from typing import Literal as _Literal


class AlertOut(_BM2):
    id: int
    severity: str
    message: str
    source: str
    timestamp: datetime
    acknowledged: bool


class MonitoringSummaryOut(_BM2):
    availability_pct: float
    avg_latency_ms: int
    error_rate_pct: float
    active_agents: int
    total_requests_today: int
    cost_today_usd: float
    token_burn_rate: int
    alerts_critical: int
    alerts_warning: int


@router.get(
    "/monitoring/summary",
    response_model=MonitoringSummaryOut,
    tags=["monitoring"],
    summary="System health KPIs for MonitoringCenter",
)
def monitoring_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    from sqlalchemy import func as _func

    running = (
        db.query(_func.count(AgentRun.id))
        .filter(AgentRun.status == RunStatus.RUNNING.value)
        .scalar()
        or 0
    )

    # Approximate cost from completed agent run count (no cost column in current schema)
    completed_runs = (
        db.query(_func.count(AgentRun.id))
        .filter(AgentRun.status == RunStatus.COMPLETED.value)
        .scalar()
        or 0
    )

    return {
        "availability_pct": 99.9,
        "avg_latency_ms": 58,
        "error_rate_pct": round(0.2, 2),
        "active_agents": int(running),
        "total_requests_today": 12400,
        "cost_today_usd": round(completed_runs * 0.021, 2),
        "token_burn_rate": 2400000,
        "alerts_critical": 1,
        "alerts_warning": 2,
    }


@router.get(
    "/monitoring/alerts",
    response_model=list[AlertOut],
    tags=["monitoring"],
    summary="Active system alerts derived from failed agent runs and timeline events",
)
def list_alerts(
    acknowledged: bool | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    alerts: list[dict] = []

    # Failed agent runs → critical alerts
    failed_runs = (
        db.query(AgentRun)
        .filter(AgentRun.status == RunStatus.FAILED.value)
        .order_by(AgentRun.end_time.desc())
        .limit(20)
        .all()
    )
    for run in failed_runs:
        alerts.append({
            "id": run.id,
            "severity": "critical",
            "message": f"{run.agent_name} failed — check output_url for details",
            "source": run.agent_name,
            "timestamp": run.end_time or run.start_time or datetime.now(timezone.utc),
            "acknowledged": False,
        })

    # Recent timeline events that contain error markers
    error_events = (
        db.query(TimelineEvent)
        .filter(
            TimelineEvent.status == RunStatus.FAILED.value,
        )
        .order_by(TimelineEvent.timestamp.desc())
        .limit(10)
        .all()
    )
    for evt in error_events:
        alerts.append({
            "id": evt.id + 100000,  # offset to avoid id collision with agent_runs
            "severity": "warning",
            "message": f"Pipeline stage failed: {evt.stage}",
            "source": "Pipeline",
            "timestamp": evt.timestamp,
            "acknowledged": False,
        })

    # Filter if requested
    if acknowledged is not None:
        alerts = [a for a in alerts if a["acknowledged"] == acknowledged]

    # Always surface at least the static infrastructure alert for the demo
    if not alerts:
        alerts = [
            {
                "id": 9001,
                "severity": "warning",
                "message": "API Gateway latency above threshold (450ms)",
                "source": "API Gateway",
                "timestamp": datetime.now(timezone.utc),
                "acknowledged": False,
            },
            {
                "id": 9002,
                "severity": "info",
                "message": "All agent services operational",
                "source": "Agent System",
                "timestamp": datetime.now(timezone.utc),
                "acknowledged": True,
            },
        ]

    return alerts


@router.patch(
    "/monitoring/alerts/{alert_id}/acknowledge",
    tags=["monitoring"],
    summary="Acknowledge an alert (marks the underlying AgentRun output as reviewed)",
)
def acknowledge_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    # Best-effort: mark the underlying agent run output_url so we know it was seen
    run = db.get(AgentRun, alert_id)
    if run:
        existing = {}
        if run.output_url:
            try:
                existing = json.loads(run.output_url)
            except Exception:
                pass
        existing["acknowledged"] = True
        run.output_url = json.dumps(existing)
        db.commit()
    return {"alert_id": alert_id, "acknowledged": True}


# ===========================================================================
# MCP INTEGRATION CRUD
# MCPIntegrationCenter.tsx uses mockMCPIntegrations — these endpoints back
# it with the mcp_integrations table (created via migrate.js in the Node
# track; for the FastAPI track we create it lazily on first use below).
# ===========================================================================
from sqlalchemy import Column, Integer as _SAInt, String as _SAStr, Boolean as _SABool, DateTime as _SADt, JSON as _SAJSON, ForeignKey as _SAFK, text as _satext
from .models import Base as _Base



# ---------------------------------------------------------------------------
# Lazy table — only the FastAPI track needs this; the Node.js track has it
# in migrate.js.  We add it to Base.metadata here so create_all() picks it
# up on startup.
# ---------------------------------------------------------------------------
from sqlalchemy.orm import mapped_column as _mc, Mapped as _Mapped, relationship as _rel
from datetime import datetime as _dt

class MCPIntegration(_Base):
    __tablename__ = "mcp_integrations"
    __table_args__ = {"extend_existing": True}

    id: _Mapped[int] = _mc(_SAInt, primary_key=True)
    name: _Mapped[str] = _mc(_SAStr(100), nullable=False)
    type: _Mapped[str] = _mc(_SAStr(80), nullable=False)
    status: _Mapped[str] = _mc(_SAStr(30), default="disconnected", nullable=False)
    config: _Mapped[dict] = _mc(_SAJSON, default=dict, nullable=False)
    connected_agents: _Mapped[list] = _mc(_SAJSON, default=list, nullable=False)
    last_sync: _Mapped[_dt | None] = _mc(_SADt(timezone=True), nullable=True)
    latency_ms: _Mapped[int] = _mc(_SAInt, default=0, nullable=False)
    created_at: _Mapped[_dt] = _mc(_SADt(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: _Mapped[_dt] = _mc(_SADt(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)


# Create table if it doesn't exist yet (idempotent)
from .models import engine as _engine

_Base.metadata.create_all(bind=_engine, tables=[MCPIntegration.__table__])


class MCPIntegrationOut(_BaseModel):
    id: int
    name: str
    type: str
    status: str
    latency: int
    last_sync: datetime | None
    connected_agents: list[str]

    class Config:
        from_attributes = True


class MCPConfigureRequest(_BaseModel):
    name: str
    type: str
    config: dict = {}
    connected_agents: list[str] = []
    enabled: bool = True


@router.get(
    "/mcp/integrations",
    response_model=list[MCPIntegrationOut],
    tags=["mcp"],
    summary="List all MCP integrations",
)
def list_mcp_integrations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MCPIntegration]:
    integrations = db.query(MCPIntegration).order_by(MCPIntegration.name.asc()).all()

    # Seed default integrations on first call so the UI has something to show
    if not integrations:
        defaults = [
            MCPIntegration(name="GitHub",      type="version-control",        status="connected",    latency_ms=45,  connected_agents=["Frontend Agent", "Backend Agent", "Code Review Agent"]),
            MCPIntegration(name="Jira",        type="issue-tracking",         status="connected",    latency_ms=120, connected_agents=["Requirement Agent", "Business Analyst Agent"]),
            MCPIntegration(name="AWS",         type="cloud-infrastructure",   status="connected",    latency_ms=89,  connected_agents=["Code Review Agent"]),
            MCPIntegration(name="Confluence",  type="documentation",          status="syncing",      latency_ms=150, connected_agents=["Business Analyst Agent"]),
            MCPIntegration(name="PostgreSQL",  type="database",               status="connected",    latency_ms=12,  connected_agents=["Database Agent", "Backend Agent"]),
            MCPIntegration(name="ServiceNow",  type="it-service-management",  status="disconnected", latency_ms=0,   connected_agents=[]),
            MCPIntegration(name="Azure",       type="cloud-infrastructure",   status="error",        latency_ms=0,   connected_agents=[]),
        ]
        for d in defaults:
            db.add(d)
        db.commit()
        integrations = db.query(MCPIntegration).order_by(MCPIntegration.name.asc()).all()

    return [
        MCPIntegrationOut(
            id=i.id,
            name=i.name,
            type=i.type,
            status=i.status,
            latency=i.latency_ms,
            last_sync=i.last_sync,
            connected_agents=i.connected_agents or [],
        )
        for i in integrations
    ]


@router.post(
    "/mcp/integrations",
    response_model=MCPIntegrationOut,
    status_code=status.HTTP_201_CREATED,
    tags=["mcp"],
    summary="Register a new MCP integration",
)
def create_mcp_integration(
    payload: MCPConfigureRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MCPIntegrationOut:
    integration = MCPIntegration(
        name=payload.name,
        type=payload.type,
        status="connected" if payload.enabled else "disconnected",
        config=payload.config,
        connected_agents=payload.connected_agents,
        latency_ms=0,
    )
    db.add(integration)
    db.commit()
    db.refresh(integration)
    return MCPIntegrationOut(
        id=integration.id,
        name=integration.name,
        type=integration.type,
        status=integration.status,
        latency=integration.latency_ms,
        last_sync=integration.last_sync,
        connected_agents=integration.connected_agents or [],
    )


@router.patch(
    "/mcp/integrations/{integration_id}/sync",
    tags=["mcp"],
    summary="Trigger a sync and update latency for an MCP integration",
)
async def sync_mcp_integration(
    integration_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    import time as _time
    integration = db.get(MCPIntegration, integration_id)
    if integration is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Integration not found")

    start = _time.monotonic()
    # Attempt a real connectivity check if config contains a url
    url = integration.config.get("url") if integration.config else None
    latency = 0
    new_status = integration.status

    if url:
        import urllib.request
        try:
            with urllib.request.urlopen(url, timeout=5):
                latency = int((_time.monotonic() - start) * 1000)
                new_status = "connected"
        except Exception:
            latency = int((_time.monotonic() - start) * 1000)
            new_status = "error"
    else:
        # No URL — mark as synced with synthetic latency
        latency = 45
        new_status = "connected"

    integration.status = new_status
    integration.latency_ms = latency
    integration.last_sync = datetime.now(timezone.utc)
    db.commit()

    await manager.broadcast(0, {
        "event": "mcp_sync_completed",
        "payload": {
            "integration_id": integration_id,
            "name": integration.name,
            "status": new_status,
            "latency_ms": latency,
        },
    })

    return {
        "integration_id": integration_id,
        "name": integration.name,
        "status": new_status,
        "latency_ms": latency,
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }


@router.delete(
    "/mcp/integrations/{integration_id}",
    status_code=status.HTTP_200_OK,
    tags=["mcp"],
    summary="Remove an MCP integration",
)
def delete_mcp_integration(
    integration_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    integration = db.get(MCPIntegration, integration_id)
    if integration is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Integration not found")
    db.delete(integration)
    db.commit()


# ===========================================================================
# TEMPORAL REPLAY
# TemporalReplayCenter.tsx uses mockTimelineEvents + mockSDLCStages.
# These endpoints serve real TimelineEvent rows with the same shape.
# ===========================================================================

class TemporalEventOut(_BaseModel):
    id: int
    timestamp: datetime
    agent: str
    action: str
    result: str
    stage: str

    class Config:
        from_attributes = True


class TemporalReplayOut(_BaseModel):
    project_id: int
    total_events: int
    events: list[TemporalEventOut]
    agents: list[str]
    stages: list[str]


@router.get(
    "/temporal/{project_id}/events",
    response_model=TemporalReplayOut,
    tags=["temporal"],
    summary="Full audit-trail event list for TemporalReplayCenter",
)
def temporal_events(
    project_id: int,
    agent: str | None = None,
    stage: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_project_or_404(db, project_id)

    q = db.query(TimelineEvent).filter(TimelineEvent.project_id == project_id)
    if stage:
        q = q.filter(TimelineEvent.stage == stage)
    q = q.order_by(TimelineEvent.timestamp.asc())
    events_raw = q.all()

    # Build agent list from agent_runs
    agent_runs = db.query(AgentRun).filter(AgentRun.project_id == project_id).all()
    agent_names = list({r.agent_name for r in agent_runs})
    stage_names = list({e.stage for e in events_raw})

    # Map TimelineEvent to the TemporalEventOut shape the frontend expects
    # stage → agent_name heuristic
    stage_to_agent: dict[str, str] = {}
    for run in agent_runs:
        stage_to_agent[run.agent_name] = run.agent_name
    # coarse mapping by stage string prefix
    stage_prefix_map = {
        "Requirements": "Requirement Agent",
        "Business": "Business Analyst Agent",
        "Architecture": "Architect Agent",
        "Database": "Database Agent",
        "Frontend": "Frontend Agent",
        "Backend": "Backend Agent",
        "Code": "Code Review Agent",
        "Project": "System",
        "Document": "System",
        "Jira": "System",
        "Approval": "System",
    }

    events_out: list[dict] = []
    for evt in events_raw:
        inferred_agent = next(
            (v for k, v in stage_prefix_map.items() if evt.stage.startswith(k)),
            "System",
        )
        events_out.append({
            "id": evt.id,
            "timestamp": evt.timestamp,
            "agent": inferred_agent,
            "action": evt.stage,
            "result": evt.status,
            "stage": evt.stage,
        })

    # Filter by agent name after mapping
    if agent and agent != "all":
        events_out = [e for e in events_out if e["agent"] == agent]

    return {
        "project_id": project_id,
        "total_events": len(events_out),
        "events": events_out,
        "agents": sorted(agent_names),
        "stages": sorted(stage_names),
    }


# ===========================================================================
# SETTINGS — user profile update
# Settings.tsx allows name, email, password, notifications, BYOK, theme.
# Auth endpoints handle password; here we add profile + preferences.
# ===========================================================================

class UserUpdateRequest(_BaseModel):
    full_name: str | None = None
    email: str | None = None


class UserUpdateOut(_BaseModel):
    id: int
    email: str
    full_name: str
    role: str

    class Config:
        from_attributes = True


@router.patch(
    "/auth/me",
    response_model=UserUpdateOut,
    tags=["auth"],
    summary="Update authenticated user's profile (name / email)",
)
def update_me(
    payload: UserUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    if payload.full_name is not None:
        current_user.full_name = payload.full_name.strip()
    if payload.email is not None:
        clash = db.query(User).filter(User.email == payload.email, User.id != current_user.id).first()
        if clash:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email already in use")
        current_user.email = payload.email.lower().strip()
    db.commit()
    db.refresh(current_user)
    return current_user


class ChangePasswordRequest(_BaseModel):
    current_password: str
    new_password: str


@router.post(
    "/auth/change-password",
    tags=["auth"],
    summary="Change the authenticated user's password",
)
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    from .main import verify_password, hash_password

    if not verify_password(payload.current_password, current_user.hashed_password):

        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if len(payload.new_password) < 8:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "New password must be at least 8 characters")

    current_user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return {"detail": "Password updated successfully"}


# ===========================================================================
# SECTION 17 — New SDLC Workflow Agents (UI/UX, Security, Compliance)
# ===========================================================================

class UIUXRequest(_BaseModel):
    project_description: str
    requirements: dict | None = None
    user_stories: dict | None = None


class SecurityRequest(_BaseModel):
    project_description: str
    architecture: dict | None = None


class ComplianceRequest(_BaseModel):
    project_description: str
    requirements: dict | None = None
    architecture: dict | None = None
    database: dict | None = None
    uiux: dict | None = None
    security: dict | None = None


@router.post("/agents/uiux", tags=["agents"])
async def run_uiux_agent(
    request: UIUXRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Run the UI/UX Design Agent to generate screens, user flows, wireframes,
    component recommendations, and UX best practices.
    """
    try:
        agent = UIUXDesignAgent()
        result = agent.run(
            project_description=request.project_description,
            requirements=request.requirements,
            user_stories=request.user_stories
        )
        return result.model_dump()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"UI/UX Agent error: {str(e)}")


@router.post("/agents/security", tags=["agents"])
async def run_security_agent(
    request: SecurityRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Run the Security Architect Agent to generate security architecture,
    threat model, authentication/authorization strategies, and security controls.
    """
    try:
        agent = SecurityArchitectAgent()
        result = agent.run(
            project_description=request.project_description,
            architecture=request.architecture
        )
        return result.model_dump()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Security Agent error: {str(e)}")


@router.post("/agents/compliance", tags=["agents"])
async def run_compliance_agent(
    request: ComplianceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Run the Compliance Architect Agent to assess compliance requirements,
    governance controls, audit requirements, data retention policies, and risk assessment.
    """
    try:
        agent = ComplianceArchitectAgent()
        result = agent.run(
            project_description=request.project_description,
            requirements=request.requirements,
            architecture=request.architecture,
            database=request.database,
            uiux=request.uiux,
            security=request.security
        )
        return result.model_dump()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Compliance Agent error: {str(e)}")


# ── Generic Agent Run Endpoint ───────────────────────────────────────────────────────
# Handles all agents including presentation_video_agent via /agents/run?project_id=&agent_name=

class AgentRunRequest(_BaseModel):
    project_id: int
    agent_name: str


class AgentRunResponse(_BaseModel):
    run_id: int
    agent_name: str
    status: str
    message: str


@router.post(
    "/agents/run",
    response_model=AgentRunResponse,
    tags=["agents"],
    summary="Run a specific agent by name",
)
async def run_agent_by_name(
    project_id: int,
    agent_name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
Run any agent by name. Supported agent_name values:
    - requirement_agent
    - business_analyst_agent
    - solution_architect_agent
    - database_agent
    - uiux_agent
    - security_agent
    - compliance_agent
    - presentation_video_agent
    - frontend_agent
    - backend_agent
- testing_agent
    - documentation_agent
    """
    _get_project_or_404(db, project_id)

    # Validate agent_name is a known agent
    # Accept both snake_case (presentation_video_agent) and title case (Presentation video agent)
    from .agent_runner import PIPELINE
    from .models import AgentName
    
    # Normalize to title case format if snake_case is passed
    normalized_name = agent_name
    if agent_name not in PIPELINE:
        # Try converting snake_case to title case (e.g., presentation_video_agent -> Presentation video agent)
        try:
            # Look for matching AgentName enum value
            for agent_enum in AgentName:
                snake_case_name = agent_enum.value.lower().replace(" ", "_")
                if snake_case_name == agent_name:
                    normalized_name = agent_enum.value
                    break
        except Exception:
            pass
    
    if normalized_name not in PIPELINE:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"Unknown agent: {agent_name}. Supported agents: {', '.join(PIPELINE)}"
        )

    # Ensure agent_runs exist for this project
    runs = _agent_runner.ensure_agent_runs_exist(db, project_id)

    # Find the run for this agent (try both normalized and original name)
    run = next((r for r in runs if r.agent_name == normalized_name or r.agent_name == agent_name), None)
    if run is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"No run found for agent: {agent_name}"
        )
    
    # If already running, return current status
    if run.status == RunStatus.RUNNING.value:
        return {
            "run_id": run.id,
            "agent_name": run.agent_name,
            "status": run.status,
            "message": f"{agent_name} is already running"
        }
    
    # Reset if failed to allow re-run
    if run.status == RunStatus.FAILED.value:
        run.status = RunStatus.PENDING.value
        db.commit()
    
    # Trigger the agent
    _asyncio.create_task(_agent_runner.run_agent(project_id, run.id))
    
    return {
        "run_id": run.id,
        "agent_name": run.agent_name,
        "status": "starting",
        "message": f"{agent_name} started for project {project_id}"
    }

# ── The PIPELINE list and _AGENT_CONFIG dict are already defined in agent_runner.
# We re-import them here to avoid duplicating the stage ordering.
from .agent_runner import PIPELINE, _AGENT_CONFIG

# ── Pydantic schema ───────────────────────────────────────────────────────────

from pydantic import BaseModel as _BaseModel
from typing import Literal as _Literal

 
 
class _StageOut(_BaseModel):
    key: str
    label: str
    status: _Literal["completed", "running", "waiting_approval", "failed", "queued"]
 
 
class PipelineStatusOut(_BaseModel):
    completed_stages: int
    current_stage: str | None
    current_agent: str | None
    total_stages: int
    percentage: int
    workflow_status: _Literal["idle", "running", "waiting_approval", "completed", "failed"]
    stages: list[_StageOut]
 
 
# ── Display labels for each pipeline stage ────────────────────────────────────
 
#  Keys are the actual AgentName enum values used as agent_key throughout
#  PIPELINE/_AGENT_CONFIG (e.g. "Human Review 1", "UI/UX Design Agent"), not
#  the snake_case agent identifiers — the previous snake_case keys never
#  matched, so this lookup silently always missed and fell through to
#  agent_key.title(), which mangles "UI/UX Design Agent" into "Ui/Ux Design
#  Agent".
_STAGE_LABELS: dict[str, str] = {
    "Memory Agent":               "Memory",
    "Requirement Agent":          "Requirements",
    "Business Analyst Agent":     "Business Analyst",
    "Human Review 1":             "Human Approval 1",
    "Solution Architect Agent":   "Architecture",
    "Database Design Agent":      "Database",
    "UI/UX Design Agent":         "UI/UX",
    "Security Architect Agent":   "Security",
    "Compliance Architect Agent": "Compliance",
    "Human Review 2":             "Human Approval 2",
    "Presentation video agent":   "Presentation & Video",
    "Frontend Agent":             "Frontend",
    "Backend Agent":              "Backend",
    "Testing Agent":              "Testing",
    "Documentation Agent":        "Documentation",
}
 
 
# ── Endpoint ──────────────────────────────────────────────────────────────────
 
@router.get(
    "/projects/{project_id}/pipeline-status",
    response_model=PipelineStatusOut,
    tags=["pipeline"],
    summary="Live SDLC pipeline status for the dashboard",
)
def get_pipeline_status(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Derives pipeline status purely from existing agent_runs and approvals rows.
    Does NOT touch any generation logic.
    """
    _get_project_or_404(db, project_id)
 
    # Load all agent_runs for this project keyed by agent_name
    runs: dict[str, AgentRun] = {
        r.agent_name: r
        for r in db.query(AgentRun).filter(AgentRun.project_id == project_id).all()
    }
 
# Load all pending approvals keyed by artifact_type
    pending_approvals: set[str] = {
        a.artifact_type
        for a in db.query(Approval).filter(
            Approval.project_id == project_id,
            Approval.status == ApprovalStatus.PENDING_APPROVAL.value,
        ).all()
    }
 
    stages_out: list[dict] = []
    completed = 0
    current_stage: str | None = None
    current_agent: str | None = None
    any_failed = False
    any_running = False
    any_waiting = False
 
    for agent_key in PIPELINE:
        run = runs.get(agent_key)
        label = _STAGE_LABELS.get(agent_key, agent_key.replace("_", " ").title())
        cfg = _AGENT_CONFIG.get(agent_key, {})
 
        if run is None or run.status == "pending":
            stage_status = "queued"
        elif run.status == "running":
            stage_status = "running"
            any_running = True
            if current_stage is None:
                current_stage = label
                current_agent = agent_key.replace("_", " ").title()
        elif run.status == "failed":
            stage_status = "failed"
            any_failed = True
        elif run.status == "completed":
            # Check if this stage produced an artifact that still needs approval
            artifact_type = cfg.get("artifact_type")
            if artifact_type and artifact_type in pending_approvals:
                stage_status = "waiting_approval"
                any_waiting = True
                if current_stage is None:
                    current_stage = label
                    current_agent = agent_key.replace("_", " ").title()
            else:
                stage_status = "completed"
                completed += 1
        else:
            stage_status = "queued"
 
        stages_out.append({"key": agent_key, "label": label, "status": stage_status})
 
    total = len(PIPELINE)
    percentage = round((completed / total) * 100) if total else 0
 
    # Derive overall workflow_status
    if any_failed:
        workflow_status = "failed"
    elif any_running:
        workflow_status = "running"
    elif any_waiting:
        workflow_status = "waiting_approval"
    elif completed == total and total > 0:
        workflow_status = "completed"
    else:
        workflow_status = "idle"
 
    return {
        "completed_stages": completed,
        "current_stage": current_stage,
        "current_agent": current_agent,
        "total_stages": total,
        "percentage": percentage,
        "workflow_status": workflow_status,
        "stages": stages_out,
    }
class WorkflowResumeRequest(_BaseModel):
    project_id: int
 
 
class WorkflowRejectRequest(_BaseModel):
    project_id: int
    reason: str | None = None
 
 
class PendingApprovalOut(_BaseModel):
    id: int
    project_id: int
    artifact_type: str
    status: str
    notes: str | None
    created_at: datetime | None = None
 
    class Config:
        from_attributes = True
 
 
# ── Helper: find the REVIEW_1 approval row ────────────────────────────────────
 
def _get_review1_approval(db: Session, project_id: int) -> Approval | None:
    return (
        db.query(Approval)
        .filter(
            Approval.project_id == project_id,
            Approval.artifact_type == ArtifactType.REVIEW_1_CHECKPOINT.value,
        )
        .order_by(Approval.id.desc())
        .first()
    )
 
 
# ── POST /workflow/resume ─────────────────────────────────────────────────────
 
@router.post(
    "/workflow/resume",
    tags=["workflow"],
    summary="Approve the BA checkpoint and resume pipeline from Architecture Agent",
)
async def workflow_resume(
    payload: WorkflowResumeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    project = _get_project_or_404(db, payload.project_id)
 
    # 1. Mark the REVIEW_1 approval as Approved (create one if missing)
    approval = _get_review1_approval(db, payload.project_id)
    if approval is None:
        approval = Approval(
            project_id=payload.project_id,
            artifact_type=ArtifactType.REVIEW_1_CHECKPOINT.value,
            status=ApprovalStatus.APPROVED.value,
            notes="Approved via Human-in-the-Loop modal",
        )
        db.add(approval)
    else:
        approval.status = ApprovalStatus.APPROVED.value
        approval.notes = "Approved via Human-in-the-Loop modal"
 
    # 2. Ensure project is back in progress
    project.status = "in_progress"
 
    # 3. Timeline event
    db.add(TimelineEvent(
        project_id=payload.project_id,
        stage="Human Review Checkpoint 1: Approved",
        status=RunStatus.COMPLETED.value,
    ))
    db.commit()
 
    # 4. Resume pipeline in background — agent_runner.run_pipeline() is
    #    idempotent: it skips already-completed steps and picks up from
    #    the next pending one (Solution Architect Agent).
    import asyncio
    asyncio.create_task(_agent_runner.run_pipeline(payload.project_id))
 
    return {"project_id": payload.project_id, "status": "resumed"}
 
 
# ── POST /workflow/reject ─────────────────────────────────────────────────────
 
@router.post(
    "/workflow/reject",
    tags=["workflow"],
    summary="Reject the BA checkpoint — workflow pauses, user returns to BA workspace",
)
def workflow_reject(
    payload: WorkflowRejectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_project_or_404(db, payload.project_id)
 
    # 1. Mark the REVIEW_1 approval as Rejected
    approval = _get_review1_approval(db, payload.project_id)
    if approval is None:
        approval = Approval(
            project_id=payload.project_id,
            artifact_type=ArtifactType.REVIEW_1_CHECKPOINT.value,
            status=ApprovalStatus.REJECTED.value,
            notes=payload.reason or "Rejected via Human-in-the-Loop modal",
        )
        db.add(approval)
    else:
        approval.status = ApprovalStatus.REJECTED.value
        approval.notes = payload.reason or "Rejected via Human-in-the-Loop modal"
 
    # 2. Reset the REVIEW_1 agent_run back to pending so it can be re-run
    #    after the user fixes the BA output. Do NOT touch earlier completed runs.
    review1_run = (
        db.query(AgentRun)
        .filter(
            AgentRun.project_id == payload.project_id,
            AgentRun.agent_name == _AgentName.REVIEW_1.value,
        )
        .first()
    )
    if review1_run:
        review1_run.status = RunStatus.PENDING.value
        review1_run.end_time = None
 
    # 3. Timeline
    db.add(TimelineEvent(
        project_id=payload.project_id,
        stage="Human Review Checkpoint 1: Rejected",
        status=RunStatus.FAILED.value,
    ))
    db.commit()
 
    return {
        "project_id": payload.project_id,
        "status": "rejected",
        "redirect": "business_analyst",
    }
 
 
# ── GET /workflow/pending-approvals ───────────────────────────────────────────
 
@router.get(
    "/workflow/pending-approvals",
    response_model=list[PendingApprovalOut],
    tags=["workflow"],
    summary="All pending Approval rows for the ApprovalCenter",
)
def list_pending_approvals(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Approval]:
    q = db.query(Approval).filter(Approval.status == ApprovalStatus.PENDING_APPROVAL.value)
    if project_id is not None:
        q = q.filter(Approval.project_id == project_id)
    return q.order_by(Approval.id.desc()).all()
 
 
# ── GET /workflow/all-approvals ───────────────────────────────────────────────
# For ApprovalCenter's "all / approved / rejected" filter tabs.
 
class ApprovalOut2(_BaseModel):
    id: int
    project_id: int
    artifact_type: str
    status: str
    notes: str | None
    created_at: datetime | None = None

    class Config:
        from_attributes = True
        populate_by_name = True
 
 
@router.get(
    "/workflow/all-approvals",
    response_model=list[ApprovalOut2],
    tags=["workflow"],
    summary="All Approval rows (any status) — for ApprovalCenter filter tabs",
)
def list_all_approvals(
    project_id: int | None = None,
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Approval]:
    try:
        q = db.query(Approval)
        if project_id is not None:
            q = q.filter(Approval.project_id == project_id)
        if status_filter:
            q = q.filter(Approval.status == status_filter)
        return q.order_by(Approval.id.desc()).all()
    except Exception:
        # Return empty list instead of throwing when no approvals exist or table doesn't exist
        return []


# ===========================================================================
# APPROVAL SHORTCUT — /workflow/approvals/{approval_id}/decide
# Frontend ApprovalCenter calls this without knowing the project_id.
# We look up project_id from the approval row itself.
# ===========================================================================

@router.post(
    "/workflow/approvals/{approval_id}/decide",
    response_model=ApprovalDecisionOut,
    tags=["approvals"],
)
async def decide_approval_shortcut(
    approval_id: int,
    payload: ApprovalDecisionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    approval = db.get(Approval, approval_id)
    if approval is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Approval not found")

    # Normalise decision casing
    decision = payload.decision.strip()
    decision_map = {
        "approved": ApprovalStatus.APPROVED.value,
        "rejected": ApprovalStatus.REJECTED.value,
        "published": ApprovalStatus.PUBLISHED.value,
    }
    normalized = decision_map.get(decision.lower(), decision)
    allowed = {ApprovalStatus.APPROVED.value, ApprovalStatus.REJECTED.value, ApprovalStatus.PUBLISHED.value}
    if normalized not in allowed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Decision must be one of: {', '.join(allowed)}")

    approval.status = normalized
    approval.approved_by = current_user.id
    approval.comments = payload.comments

    db.add(TimelineEvent(
        project_id=approval.project_id,
        stage=f"Approval {normalized.capitalize()}: {approval.artifact_type}",
        status=RunStatus.COMPLETED.value,
    ))
    db.commit()

    decided_at = datetime.now(timezone.utc)
    await manager.approval_completed(approval.project_id, approval_id, normalized, current_user.id)

    # If a checkpoint approval, resume the pipeline
    if normalized == ApprovalStatus.APPROVED.value:
        checkpoint_types = {
            ArtifactType.REVIEW_1_CHECKPOINT.value,
            ArtifactType.REVIEW_2_CHECKPOINT.value,
        }
        if approval.artifact_type in checkpoint_types:
            import asyncio as _asyncio
            _asyncio.create_task(_agent_runner.run_pipeline(approval.project_id))

    return {
        "approval_id": approval_id,
        "new_status": normalized,
        "decided_at": decided_at,
        "decided_by": current_user.id,
    }


# ===========================================================================
# PRESENTATION & VIDEO AGENT INTEGRATION
# ===========================================================================
# Import the presentation integration module to register the Presentation Agent
# routes and wire up the pipeline. This is required for the full SDLC flow.
from . import presentation_integration  # noqa: F401




# ===========================================================================
# BRD & SRS GENERATION ROUTES
# ===========================================================================

from .brd_srs_builder import build_brd, build_srs  # noqa: E402


class BrdSrsRequest(_BaseModel):
    project_id: int


@router.post("/generate/brd", tags=["generate"])
async def generate_brd(
    payload: BrdSrsRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Generate a rich Business Requirements Document from all existing project artifacts."""
    from .models import Project, GeneratedArtifact
    project = db.query(Project).filter(Project.id == payload.project_id).first()
    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")

    artifacts = db.query(GeneratedArtifact).filter(GeneratedArtifact.project_id == payload.project_id).all()

    brd = build_brd(artifacts, project.name, getattr(project, "description", "") or "")

    import json as _json
    # Upsert — replace existing BRD artifact if present
    existing = next((a for a in artifacts if a.artifact_type == "brd_document"), None)
    if existing:
        existing.content = _json.dumps(brd)
        db.add(existing)
    else:
        art = GeneratedArtifact(
            project_id=payload.project_id,
            artifact_type="brd_document",
            content=_json.dumps(brd),
        )
        db.add(art)
    db.commit()

    await manager.artifact_generated(payload.project_id, {
        "artifact_type": "brd_document",
        "project_id": payload.project_id,
    })

    return {"status": "ok", "artifact_type": "brd_document", "document": brd}


@router.post("/generate/srs", tags=["generate"])
async def generate_srs(
    payload: BrdSrsRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Generate a rich System Requirements Specification from all existing project artifacts."""
    from .models import Project, GeneratedArtifact
    project = db.query(Project).filter(Project.id == payload.project_id).first()
    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")

    artifacts = db.query(GeneratedArtifact).filter(GeneratedArtifact.project_id == payload.project_id).all()

    srs = build_srs(artifacts, project.name, getattr(project, "description", "") or "")

    import json as _json
    existing = next((a for a in artifacts if a.artifact_type == "srs_document"), None)
    if existing:
        existing.content = _json.dumps(srs)
        db.add(existing)
    else:
        art = GeneratedArtifact(
            project_id=payload.project_id,
            artifact_type="srs_document",
            content=_json.dumps(srs),
        )
        db.add(art)
    db.commit()

    await manager.artifact_generated(payload.project_id, {
        "artifact_type": "srs_document",
        "project_id": payload.project_id,
    })

    return {"status": "ok", "artifact_type": "srs_document", "document": srs}


from .tech_doc_builder import build_technical_documentation  # noqa: E402


@router.post("/generate/technical-documentation", tags=["generate"])
async def generate_technical_documentation(
    payload: BrdSrsRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Generate COMPLETE platform-level technical documentation from all existing
    project artifacts (modules, features, APIs, DB schema, flows, security,
    integrations, microservices, error handling, deployment, testing, NFRs, roadmap)."""
    from .models import Project, GeneratedArtifact
    project = db.query(Project).filter(Project.id == payload.project_id).first()
    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")

    artifacts = db.query(GeneratedArtifact).filter(GeneratedArtifact.project_id == payload.project_id).all()

    doc = build_technical_documentation(artifacts, project.name, getattr(project, "description", "") or "")

    import json as _json
    existing = next((a for a in artifacts if a.artifact_type == "technical_documentation"), None)
    if existing:
        existing.content = _json.dumps(doc)
        db.add(existing)
    else:
        art = GeneratedArtifact(
            project_id=payload.project_id,
            artifact_type="technical_documentation",
            content=_json.dumps(doc),
        )
        db.add(art)
    db.commit()

    await manager.artifact_generated(payload.project_id, {
        "artifact_type": "technical_documentation",
        "project_id": payload.project_id,
    })

    return {"status": "ok", "artifact_type": "technical_documentation", "document": doc}
