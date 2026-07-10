"""
agent_runner.py
===============
Pure pipeline orchestration: sequencing, approval gates, checkpoint-resume,
and dispatch. No agent-specific generation logic lives here — every
capability is implemented by its own agent class under agents/<name>/ and
looked up polymorphically via agents.registry.AgentFactory. This module
never imports ai_service or any individual agent module directly; it only
knows AgentName values and the AgentFactory/AgentRegistry contract.
"""
from __future__ import annotations

import asyncio
import json
import logging
import traceback
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from .agents.developer_studio.agent import DeveloperStudioAgent
from .agents.llm_service import LLMService
from .agents.registry import AgentFactory

from .models import (
    AgentName,
    AgentRun,
    Approval,
    ApprovalStatus,
    ArtifactType,
    GeneratedArtifact,
    Project,
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
        "generate": True,
        "artifact_type": ArtifactType.REQUIREMENTS_DOC.value,
        "approval": True,
        "stage": "Requirements",
    },
    AgentName.BUSINESS_ANALYST_AGENT.value: {
        "generate": True,
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
        "generate": True,
        "artifact_type": ArtifactType.ARCHITECTURE_DIAGRAM.value,
        "approval": True,
        "stage": "Solution Architecture",
    },
    AgentName.DATABASE_AGENT.value: {
        "generate": True,
        "artifact_type": ArtifactType.SQL_SCHEMA.value,
        "approval": True,
        "stage": "Database Design",
    },
    AgentName.UIUX_AGENT.value: {
        "generate": True,
        "artifact_type": ArtifactType.UIUX_DESIGN.value,
        "approval": False,
        "stage": "UI/UX Design",
    },
    AgentName.SECURITY_AGENT.value: {
        "generate": True,
        "artifact_type": ArtifactType.SECURITY_REPORT.value,
        "approval": False,
        "stage": "Security Architecture",
    },
    AgentName.COMPLIANCE_AGENT.value: {
        "generate": True,
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
        "generate": True,
        "artifact_type": ArtifactType.PRESENTATION.value,
        "approval": False,
        "stage": "Presentation & Video Generation",
    },
    AgentName.FRONTEND_AGENT.value: {
        "generate": True, "artifact_type": ArtifactType.REACT_CODE.value,
        "approval": False, "stage": "Frontend Development",
    },
    AgentName.BACKEND_AGENT.value: {
        "generate": True, "artifact_type": ArtifactType.BACKEND_CODE.value,
        "approval": False, "stage": "Backend Development",
    },
    AgentName.TESTING_AGENT.value: {
        "generate": True, "artifact_type": ArtifactType.TEST_REPORT.value,
        "approval": False, "stage": "Testing",
    },
    AgentName.DOCUMENTATION_AGENT.value: {
        "generate": True, "artifact_type": ArtifactType.DOCUMENTATION.value,
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
    elif agent_name == AgentName.FRONTEND_AGENT.value:
        # Previously empty — Frontend generation had zero visibility into
        # what the project actually needs (requirements/user stories) or its
        # architecture/UI/UX design, and could never actually build the
        # described features or follow the project's own tech stack/style.
        prior_types = [
            ArtifactType.REQUIREMENTS_DOC.value,
            ArtifactType.USER_STORIES.value,
            ArtifactType.ARCHITECTURE_DIAGRAM.value,
            ArtifactType.UIUX_DESIGN.value,
            "selected_ui_style",
        ]
    elif agent_name == AgentName.BACKEND_AGENT.value:
        prior_types = [
            ArtifactType.REQUIREMENTS_DOC.value,
            ArtifactType.USER_STORIES.value,
            ArtifactType.ARCHITECTURE_DIAGRAM.value,
            ArtifactType.SQL_SCHEMA.value,
        ]
    else:
        prior_types = []

    # Groq's free-tier tokens-per-minute budget is easily blown once several
    # artifacts (especially uiux_design, which carries a full style-option
    # set) are concatenated — same failure class the presentation pipeline
    # hit (see LLMService.has_generous_context_path). Cap harder unless a
    # genuinely large-context provider is actually available.
    generous = LLMService(db=db, project_id=project.id).has_generous_context_path()
    per_artifact_limit = 6000 if generous else 3000

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
            content = artifact.content[:per_artifact_limit] if len(artifact.content) > per_artifact_limit else artifact.content
            base += f"--- {art_type} ---\n{content}\n\n"
    return base.strip()


def dispatch(agent_name: str, db: Session, project_id: int, context: str) -> Any:
    """The single place that turns an AgentName into a real generation
    call. Looks up the agent class via AgentFactory (polymorphism) and
    calls its `.generate(...)` — replaces the old
    `getattr(ai_service, generate_name)` string-based dispatch entirely.
    Raises AttributeError if `agent_name` has no registered agent, mirroring
    the old getattr-miss behavior so _execute_agent's error handling is
    unchanged."""
    agent = AgentFactory.create(agent_name, db=db, project_id=project_id)
    if agent is None:
        raise AttributeError(f"No agent registered for '{agent_name}'")
    return agent.generate(db, project_id, context)


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
    should_generate = cfg.get("generate")
    artifact_type = cfg.get("artifact_type")

    if should_generate and artifact_type:
        context = _build_context(db, project, run.agent_name)

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: dispatch(run.agent_name, db, project.id, context))
        content = json.dumps(result, ensure_ascii=False)

        artifact = GeneratedArtifact(
            project_id=project.id,
            artifact_type=artifact_type,
            content=content,
        )
        db.add(artifact)
        db.flush()
        artifact_id = artifact.id

        # Live "streaming" code generation for the Development Studio: the
        # file content is already fully generated at this point — this just
        # re-broadcasts it over the existing per-project WebSocket in small,
        # paced chunks so the UI can render it as if it were streaming in.
        # Only frontend/backend agents produce a `files` array; anything
        # else is a no-op. Never raises — a streaming hiccup must never
        # fail code generation itself.
        if artifact_type in (ArtifactType.REACT_CODE.value, ArtifactType.BACKEND_CODE.value):
            files = result.get("files") if isinstance(result, dict) else None
            if files:
                agent_type = "frontend" if artifact_type == ArtifactType.REACT_CODE.value else "backend"
                await DeveloperStudioAgent.stream_generated_files(project.id, agent_type, files)

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
    run.output_url = None  # clear any stale error from a prior failed attempt on this same run
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


class PipelineExecutor:
    """Owns the stage sequence, approval gates, checkpoint-reuse-on-resume
    logic, and the non-blocking Presentation-agent handling. `run(project_id)`
    is the only entrypoint — everything else on this class is a private
    helper. Contains no generation logic itself; every stage's actual work
    happens inside `dispatch()` -> AgentFactory -> the owning agent's
    `.generate(...)`."""

    async def run(self, project_id: int) -> None:
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

            async def _run_stage(run: AgentRun) -> bool:
                """Runs `run` if it isn't already completed, and returns True iff
                it's completed afterward (so callers just do `if not await
                _run_stage(run): return`).

                Checkpoint-recovery: if this run previously FAILED but already
                has a persisted GeneratedArtifact (e.g. the LLM call itself
                succeeded and was saved, but a later step — a WS broadcast, a
                commit — threw), reuse that artifact instead of paying for a
                fresh LLM call. This is what makes Resume (re-invoking
                run_pipeline) idempotent: it never regenerates a stage that
                already produced output, only stages that never did. Explicit
                single-agent reruns go through run_agent() instead, which always
                regenerates — that function is untouched by this helper."""
                if run.status == RunStatus.COMPLETED.value:
                    return True

                cfg = _AGENT_CONFIG.get(run.agent_name, {})
                artifact_type = cfg.get("artifact_type")
                if run.status == RunStatus.FAILED.value and artifact_type:
                    existing_artifact = (
                        db.query(GeneratedArtifact)
                        .filter(
                            GeneratedArtifact.project_id == project.id,
                            GeneratedArtifact.artifact_type == artifact_type,
                        )
                        .order_by(GeneratedArtifact.created_at.desc())
                        .first()
                    )
                    if existing_artifact is not None:
                        logger.info(
                            "[agent_runner] %s already produced artifact #%s — reusing on resume instead of regenerating",
                            run.agent_name, existing_artifact.id,
                        )
                        run.status = RunStatus.COMPLETED.value
                        run.end_time = datetime.now(timezone.utc)
                        run.output_url = None
                        db.commit()
                        await manager.agent_completed(project.id, {
                            "agent_name": run.agent_name, "run_id": run.id,
                            "status": RunStatus.COMPLETED.value, "artifact_id": existing_artifact.id,
                        })
                        return True

                await _safe_execute(db, run, project)
                db.refresh(run)
                return run.status == RunStatus.COMPLETED.value

            # Memory
            run = _get_or_create_run(AgentName.MEMORY_AGENT.value)
            if not await _run_stage(run):
                return

            # Requirements
            run = _get_or_create_run(AgentName.REQUIREMENT_AGENT.value)
            if not await _run_stage(run):
                return
            _create_approval(ArtifactType.REQUIREMENTS_DOC.value)

            # Business Analysis
            run = _get_or_create_run(AgentName.BUSINESS_ANALYST_AGENT.value)
            if not await _run_stage(run):
                return
            _create_approval(ArtifactType.USER_STORIES.value)

            # Review 1
            run = _get_or_create_run(AgentName.REVIEW_1.value)
            if not await _run_stage(run):
                return
            _create_approval(ArtifactType.REVIEW_1_CHECKPOINT.value)

            # Wait for Review 1 approval
            if not _approval_is_approved(db, project_id, ArtifactType.REVIEW_1_CHECKPOINT.value):
                logger.info("[agent_runner] Pipeline paused at Human Review Checkpoint 1 for project %s", project_id)
                return

            # Solution Architecture
            run = _get_or_create_run(AgentName.SOLUTION_ARCHITECT_AGENT.value)
            if not await _run_stage(run):
                return
            _create_approval(ArtifactType.ARCHITECTURE_DIAGRAM.value)

            # Database Design
            run = _get_or_create_run(AgentName.DATABASE_AGENT.value)
            if not await _run_stage(run):
                return
            _create_approval(ArtifactType.SQL_SCHEMA.value)

            # UI/UX + Security (parallel)
            uiux_run = _get_or_create_run(AgentName.UIUX_AGENT.value)
            security_run = _get_or_create_run(AgentName.SECURITY_AGENT.value)
            uiux_ok = await _run_stage(uiux_run)
            security_ok = await _run_stage(security_run)
            if not uiux_ok or not security_ok:
                return

            # Compliance
            run = _get_or_create_run(AgentName.COMPLIANCE_AGENT.value)
            if not await _run_stage(run):
                return
            _create_approval(ArtifactType.COMPLIANCE_REPORT.value)

            # Review 2
            run = _get_or_create_run(AgentName.REVIEW_2.value)
            if not await _run_stage(run):
                return
            _create_approval(ArtifactType.REVIEW_2_CHECKPOINT.value)

            # Wait for Review 2 approval
            if not _approval_is_approved(db, project_id, ArtifactType.REVIEW_2_CHECKPOINT.value):
                logger.info("[agent_runner] Pipeline paused at Human Review Checkpoint 2 for project %s", project_id)
                return

            # Presentation & Video — optional/non-blocking: a failure here must
            # never stop Frontend/Backend/Testing/Documentation from running.
            # (Every other stage above still halts the pipeline on failure —
            # this is the one deliberate exception.)
            run = _get_or_create_run(AgentName.PRESENTATION_VIDEO_AGENT.value)
            if not await _run_stage(run):
                logger.warning(
                    "[agent_runner] Presentation & Video failed for project %s — "
                    "continuing pipeline (non-blocking)", project_id,
                )

            # Style selection gate — mirrors the Review 1/2 approval-gate pattern
            # above. Frontend generation must not start until the user has
            # picked one of the UI/UX Agent's style directions (styleOptions on
            # the latest uiux_design artifact). Reuses the exact same
            # Approval + _approval_is_approved machinery as Review 1/2, just
            # with a synthetic artifact_type instead of a real ArtifactType enum
            # member (Approval.artifact_type is a plain string column).
            _create_approval("ui_style_selection")
            if not _approval_is_approved(db, project_id, "ui_style_selection"):
                logger.info("[agent_runner] Pipeline paused for UI style selection, project %s", project_id)
                return

            # Development, testing, documentation
            for agent_name in (
                AgentName.FRONTEND_AGENT.value,
                AgentName.BACKEND_AGENT.value,
                AgentName.TESTING_AGENT.value,
                AgentName.DOCUMENTATION_AGENT.value,
            ):
                run = _get_or_create_run(agent_name)
                if not await _run_stage(run):
                    return

            project.status = "completed"
            db.commit()
        finally:
            db.close()


async def run_pipeline(project_id: int) -> None:
    """Thin wrapper preserving the existing module-level call signature
    (`agent_runner.run_pipeline(project_id)`) used throughout main.py /
    main_extension.py — delegates to PipelineExecutor."""
    await PipelineExecutor().run(project_id)


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
