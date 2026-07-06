"""
agent_runner.py
===============
Async agent execution engine.
"""
from __future__ import annotations

import asyncio
import json
import logging
import traceback
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from . import ai_service

from .models import (
    AgentName,
    AgentRun,
    Approval,
    ApprovalStatus,
    ArtifactType,
    GeneratedArtifact,
    Project,
    ProjectDeliverable,
    RunStatus,
    TimelineEvent,
    get_db,
)
from .ws_manager import manager

logger = logging.getLogger(__name__)


PIPELINE: list[str] = [
    AgentName.MEMORY_AGENT.value,
    AgentName.REQUIREMENT_AGENT.value,
    AgentName.BUSINESS_ANALYST_AGENT.value,
    AgentName.REVIEW_1.value,
    AgentName.SOLUTION_ARCHITECT_AGENT.value,
    AgentName.DATABASE_AGENT.value,
    AgentName.UIUX_AGENT.value,
    AgentName.SECURITY_AGENT.value,
    AgentName.COMPLIANCE_AGENT.value,
    AgentName.REVIEW_2.value,
    AgentName.PRESENTATION_VIDEO_AGENT.value,
    AgentName.FRONTEND_AGENT.value,
    AgentName.BACKEND_AGENT.value,
    AgentName.TESTING_AGENT.value,
    AgentName.DOCUMENTATION_AGENT.value,
]


_AGENT_CONFIG: dict[str, dict[str, Any]] = {
    AgentName.MEMORY_AGENT.value: {
        "generate": None,
        "artifact_type": None,
        "approval": False,
        "stage": "Memory Preparation",
    },
    AgentName.REQUIREMENT_AGENT.value: {
        "generate": "generate_requirements",
        "artifact_type": ArtifactType.REQUIREMENTS_DOC.value,
        "approval": True,
        "stage": "Requirements",
    },
    AgentName.BUSINESS_ANALYST_AGENT.value: {
        "generate": "generate_user_stories",
        "artifact_type": ArtifactType.USER_STORIES.value,
        "approval": True,
        "stage": "Business Analysis",
    },
    AgentName.REVIEW_1.value: {
        "generate": None,
        "artifact_type": ArtifactType.REVIEW_1_CHECKPOINT.value,
        "approval": True,
        "stage": "Human Review Checkpoint 1",
    },
    AgentName.SOLUTION_ARCHITECT_AGENT.value: {
        "generate": "generate_architecture",
        "artifact_type": ArtifactType.ARCHITECTURE_DIAGRAM.value,
        "approval": True,
        "stage": "Solution Architecture",
    },
    AgentName.DATABASE_AGENT.value: {
        "generate": "generate_database_schema",
        "artifact_type": ArtifactType.SQL_SCHEMA.value,
        "approval": True,
        "stage": "Database Design",
    },
    AgentName.UIUX_AGENT.value: {
        "generate": "generate_uiux",
        "artifact_type": ArtifactType.UIUX_DESIGN.value,
        "approval": False,
        "stage": "UI/UX Design",
    },
    AgentName.SECURITY_AGENT.value: {
        "generate": "generate_security",
        "artifact_type": ArtifactType.SECURITY_REPORT.value,
        "approval": False,
        "stage": "Security Architecture",
    },
    AgentName.COMPLIANCE_AGENT.value: {
        "generate": "generate_compliance",
        "artifact_type": ArtifactType.COMPLIANCE_REPORT.value,
        "approval": True,
        "stage": "Compliance",
    },
    AgentName.REVIEW_2.value: {
        "generate": None,
        "artifact_type": ArtifactType.REVIEW_2_CHECKPOINT.value,
        "approval": True,
        "stage": "Human Review Checkpoint 2",
    },
    AgentName.PRESENTATION_VIDEO_AGENT.value: {
        "generate": "generate_presentation",
        "artifact_type": ArtifactType.PRESENTATION.value,
        "approval": False,
        "stage": "Presentation & Video Generation",
    },
    AgentName.FRONTEND_AGENT.value: {
        "generate": "generate_frontend", "artifact_type": ArtifactType.REACT_CODE.value,
        "approval": False, "stage": "Frontend Development",
    },
    AgentName.BACKEND_AGENT.value: {
        "generate": "generate_backend", "artifact_type": ArtifactType.BACKEND_CODE.value,
        "approval": False, "stage": "Backend Development",
    },
    AgentName.TESTING_AGENT.value: {
        "generate": "generate_testing", "artifact_type": ArtifactType.TEST_REPORT.value,
        "approval": False, "stage": "Testing",
    },
    AgentName.DOCUMENTATION_AGENT.value: {
        "generate": "generate_documentation", "artifact_type": ArtifactType.DOCUMENTATION.value,
        "approval": False, "stage": "Documentation",
    },
}


def _build_context(db: Session, project: Project, agent_name: str) -> str:
    base = f"Project: {project.name}\nDescription: {project.description or ''}\n\n"
    prior_types: list[str] = []
    if agent_name == AgentName.REQUIREMENT_AGENT.value:
        prior_types = []
    elif agent_name == AgentName.BUSINESS_ANALYST_AGENT.value:
        prior_types = [ArtifactType.REQUIREMENTS_DOC.value]
    elif agent_name == AgentName.SOLUTION_ARCHITECT_AGENT.value:
        prior_types = [ArtifactType.REQUIREMENTS_DOC.value, ArtifactType.USER_STORIES.value]
    elif agent_name == AgentName.DATABASE_AGENT.value:
        prior_types = [ArtifactType.ARCHITECTURE_DIAGRAM.value]
    elif agent_name in (AgentName.UIUX_AGENT.value, AgentName.SECURITY_AGENT.value):
        prior_types = [ArtifactType.ARCHITECTURE_DIAGRAM.value, ArtifactType.SQL_SCHEMA.value]
    elif agent_name == AgentName.COMPLIANCE_AGENT.value:
        prior_types = [
            ArtifactType.ARCHITECTURE_DIAGRAM.value,
            ArtifactType.SQL_SCHEMA.value,
            ArtifactType.API_DESIGN.value,
        ]
    else:
        prior_types = []

    for art_type in prior_types:
        artifact = (
            db.query(GeneratedArtifact)
            .filter(
                GeneratedArtifact.project_id == project.id,
                GeneratedArtifact.artifact_type == art_type,
            )
            .order_by(GeneratedArtifact.created_at.desc())
            .first()
        )
        if artifact:
            content = artifact.content[:4000] if len(artifact.content) > 4000 else artifact.content
            base += f"--- {art_type} ---\n{content}\n\n"
    return base.strip()


async def _execute_agent(db: Session, run: AgentRun, project: Project) -> None:
    cfg = _AGENT_CONFIG.get(run.agent_name)
    if cfg is None:
        raise ValueError(f"No configuration found for agent: {run.agent_name}")

    run.status = RunStatus.RUNNING.value
    run.start_time = datetime.now(timezone.utc)
    db.commit()
    await manager.agent_started(project.id, {"agent_name": run.agent_name, "run_id": run.id})

    artifact_id: int | None = None
    content: str | None = None
    approval_id: int | None = None
    generate_name = cfg.get("generate")
    artifact_type = cfg.get("artifact_type")

    if generate_name and artifact_type:
        context = _build_context(db, project, run.agent_name)
        generate_fn = getattr(ai_service, generate_name, None)
        if generate_fn is None:
            raise AttributeError(f"ai_service has no function '{generate_name}'")

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: generate_fn(db, project.id, context))
        content = json.dumps(result, ensure_ascii=False)

        artifact = GeneratedArtifact(
            project_id=project.id,
            artifact_type=artifact_type,
            content=content,
        )
        db.add(artifact)
        db.flush()
        artifact_id = artifact.id

    if cfg["approval"]:
        if not artifact_type:
            raise ValueError(f"Approval requested but no artifact_type configured for {run.agent_name}")
        approval = Approval(
            project_id=project.id,
            artifact_type=artifact_type,
            status=ApprovalStatus.PENDING_APPROVAL.value,
        )
        db.add(approval)
        db.flush()
        approval_id = approval.id

    db.add(TimelineEvent(
        project_id=project.id,
        stage=cfg["stage"],
        status=RunStatus.COMPLETED.value,
    ))

    run.status = RunStatus.COMPLETED.value
    run.end_time = datetime.now(timezone.utc)
    db.commit()

    if artifact_id is not None and artifact_type is not None:
        await manager.artifact_generated(project.id, {
            "artifact_id": artifact_id,
            "artifact_type": artifact_type,
            "agent_name": run.agent_name,
        })

    if approval_id is not None and artifact_type is not None:
        await manager.approval_requested(project.id, {
            "approval_id": approval_id,
            "artifact_type": artifact_type,
        })

    await manager.agent_completed(project.id, {
        "agent_name": run.agent_name,
        "run_id": run.id,
        "status": RunStatus.COMPLETED.value,
        "artifact_id": artifact_id,
    })


async def _safe_execute(db: Session, run: AgentRun, project: Project) -> None:
    try:
        await _execute_agent(db, run, project)
    except Exception as exc:
        tb = traceback.format_exc()
        logger.error("[agent_runner] %s FAILED: %s\n%s", run.agent_name, exc, tb)
        try:
            run.status = RunStatus.FAILED.value
            run.end_time = datetime.now(timezone.utc)
            run.output_url = json.dumps({"error": str(exc)})
            db.commit()
        except Exception:
            db.rollback()
        await manager.agent_completed(project.id, {
            "agent_name": run.agent_name,
            "run_id": run.id,
            "status": RunStatus.FAILED.value,
            "error": str(exc),
        })


async def run_agent(project_id: int, run_id: int) -> None:
    db: Session = next(get_db())
    try:
        run = db.get(AgentRun, run_id)
        if run is None or run.project_id != project_id:
            logger.warning("[agent_runner] run %s not found for project %s", run_id, project_id)
            return
        if run.status == RunStatus.RUNNING.value:
            return
        project = db.get(Project, project_id)
        if project is None:
            return
        await _safe_execute(db, run, project)
    finally:
        db.close()


def _approval_is_approved(db: Session, project_id: int, artifact_type: str) -> bool:
    a = (
        db.query(Approval)
        .filter(
            Approval.project_id == project_id,
            Approval.artifact_type == artifact_type,
        )
        .order_by(Approval.id.desc())
        .first()
    )
    return a is not None and a.status == ApprovalStatus.APPROVED.value


async def run_pipeline(project_id: int) -> None:
    db: Session = next(get_db())
    try:
        project = db.get(Project, project_id)
        if project is None:
            return

        existing: dict[str, AgentRun] = {
            r.agent_name: r
            for r in db.query(AgentRun).filter(AgentRun.project_id == project_id).all()
        }

        def _get_or_create_run(agent_name: str) -> AgentRun:
            run = existing.get(agent_name)
            if run is not None:
                return run
            run = AgentRun(
                project_id=project_id,
                agent_name=agent_name,
                status=RunStatus.PENDING.value,
            )
            db.add(run)
            db.commit()
            db.refresh(run)
            existing[agent_name] = run
            return run

        def _create_approval(artifact_type: str) -> None:
            existing_approval = (
                db.query(Approval)
                .filter(
                    Approval.project_id == project_id,
                    Approval.artifact_type == artifact_type,
                )
                .first()
            )
            if existing_approval is None:
                approval = Approval(
                    project_id=project_id,
                    artifact_type=artifact_type,
                    status=ApprovalStatus.PENDING_APPROVAL.value,
                )
                db.add(approval)
                db.commit()

        def _run_agent_and_check(agent_name: str, agent_run: AgentRun) -> bool:
            """Returns True if agent completed successfully."""
            if agent_run.status == RunStatus.COMPLETED.value:
                return True
            return False

        # Memory
        run = _get_or_create_run(AgentName.MEMORY_AGENT.value)
        if run.status != RunStatus.COMPLETED.value:
            await _safe_execute(db, run, project)
            db.refresh(run)
            if run.status == RunStatus.FAILED.value:
                return

        # Requirements
        run = _get_or_create_run(AgentName.REQUIREMENT_AGENT.value)
        if run.status != RunStatus.COMPLETED.value:
            await _safe_execute(db, run, project)
            db.refresh(run)
            if run.status == RunStatus.FAILED.value:
                return
        _create_approval(ArtifactType.REQUIREMENTS_DOC.value)

        # Business Analysis
        run = _get_or_create_run(AgentName.BUSINESS_ANALYST_AGENT.value)
        if run.status != RunStatus.COMPLETED.value:
            await _safe_execute(db, run, project)
            db.refresh(run)
            if run.status == RunStatus.FAILED.value:
                return
        _create_approval(ArtifactType.USER_STORIES.value)

        # Review 1
        run = _get_or_create_run(AgentName.REVIEW_1.value)
        if run.status != RunStatus.COMPLETED.value:
            await _safe_execute(db, run, project)
            db.refresh(run)
            if run.status == RunStatus.FAILED.value:
                return
        _create_approval(ArtifactType.REVIEW_1_CHECKPOINT.value)

        # Wait for Review 1 approval
        if not _approval_is_approved(db, project_id, ArtifactType.REVIEW_1_CHECKPOINT.value):
            logger.info("[agent_runner] Pipeline paused at Human Review Checkpoint 1 for project %s", project_id)
            return

        # Solution Architecture
        run = _get_or_create_run(AgentName.SOLUTION_ARCHITECT_AGENT.value)
        if run.status != RunStatus.COMPLETED.value:
            await _safe_execute(db, run, project)
            db.refresh(run)
            if run.status == RunStatus.FAILED.value:
                return
        _create_approval(ArtifactType.ARCHITECTURE_DIAGRAM.value)

        # Database Design
        run = _get_or_create_run(AgentName.DATABASE_AGENT.value)
        if run.status != RunStatus.COMPLETED.value:
            await _safe_execute(db, run, project)
            db.refresh(run)
            if run.status == RunStatus.FAILED.value:
                return
        _create_approval(ArtifactType.SQL_SCHEMA.value)

        # UI/UX + Security (parallel)
        uiux_run = _get_or_create_run(AgentName.UIUX_AGENT.value)
        security_run = _get_or_create_run(AgentName.SECURITY_AGENT.value)
        if uiux_run.status != RunStatus.COMPLETED.value:
            await _safe_execute(db, uiux_run, project)
        if security_run.status != RunStatus.COMPLETED.value:
            await _safe_execute(db, security_run, project)
        db.refresh(uiux_run)
        db.refresh(security_run)
        if uiux_run.status == RunStatus.FAILED.value or security_run.status == RunStatus.FAILED.value:
            return

        # Compliance
        run = _get_or_create_run(AgentName.COMPLIANCE_AGENT.value)
        if run.status != RunStatus.COMPLETED.value:
            await _safe_execute(db, run, project)
            db.refresh(run)
            if run.status == RunStatus.FAILED.value:
                return
        _create_approval(ArtifactType.COMPLIANCE_REPORT.value)

        # Review 2
        run = _get_or_create_run(AgentName.REVIEW_2.value)
        if run.status != RunStatus.COMPLETED.value:
            await _safe_execute(db, run, project)
            db.refresh(run)
            if run.status == RunStatus.FAILED.value:
                return
        _create_approval(ArtifactType.REVIEW_2_CHECKPOINT.value)

        # Wait for Review 2 approval
        if not _approval_is_approved(db, project_id, ArtifactType.REVIEW_2_CHECKPOINT.value):
            logger.info("[agent_runner] Pipeline paused at Human Review Checkpoint 2 for project %s", project_id)
            return

        # Presentation & Video
        run = _get_or_create_run(AgentName.PRESENTATION_VIDEO_AGENT.value)
        if run.status != RunStatus.COMPLETED.value:
            await _safe_execute(db, run, project)
            db.refresh(run)
            if run.status == RunStatus.FAILED.value:
                return

        # Development, testing, documentation
        for agent_name in (
            AgentName.FRONTEND_AGENT.value,
            AgentName.BACKEND_AGENT.value,
            AgentName.TESTING_AGENT.value,
            AgentName.DOCUMENTATION_AGENT.value,
        ):
            run = _get_or_create_run(agent_name)
            if run.status != RunStatus.COMPLETED.value:
                await _safe_execute(db, run, project)
                db.refresh(run)
                if run.status == RunStatus.FAILED.value:
                    return

        project.status = "completed"
        db.commit()
    finally:
        db.close()


def ensure_agent_runs_exist(db: Session, project_id: int) -> list[AgentRun]:
    existing_names = {
        r.agent_name
        for r in db.query(AgentRun).filter(AgentRun.project_id == project_id).all()
    }
    for agent_name in PIPELINE:
        if agent_name not in existing_names:
            db.add(AgentRun(
                project_id=project_id,
                agent_name=agent_name,
                status=RunStatus.PENDING.value,
            ))
    db.commit()
    return (
        db.query(AgentRun)
        .filter(AgentRun.project_id == project_id)
        .order_by(AgentRun.id.asc())
        .all()
    )