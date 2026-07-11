"""
agents/developer_studio/agent.py
==================================
Developer Studio Agent — owns the unified build-monitor / live-preview
capability. Today this is real, working streaming logic (moved verbatim
from agent_runner.py, same behavior): re-broadcasting already-generated
frontend/backend file content in small paced chunks over the per-project
WebSocket so Development Studio can render it as if it were typing in
live.

Everything below the "future capabilities" marker is intentionally NOT
implemented. These are documented interfaces for capabilities described in
the platform's roadmap for Developer Studio (dependency-conflict
resolution, frontend/backend merge/assembly, build and compile
verification, file-conflict detection, architecture-consistency
validation, generated-code review, workspace synchronization) -- each
raises NotImplementedError with a clear message. None of them are called
from anywhere; this agent stays dormant in the live pipeline exactly like
today (_AGENT_CONFIG has no "Developer Studio" stage, the same as Memory
Agent's "generate": None treatment) until a future task explicitly wires
one of these in.
"""
from __future__ import annotations

import asyncio
from ...logging_config import get_logger

from ...ws_manager import manager

logger = get_logger(__name__)


def resolve_full_path(file: dict) -> str:
    """LLM output is inconsistent about whether `path` already includes the
    filename (e.g. "src/components/Foo.tsx") or is just the containing
    directory (e.g. "src/components", with the filename only in `name`) —
    seen in practice with smaller/rate-limited models. Combine defensively
    so two files in the same directory never collide under one identity."""
    path = str(file.get("path") or "").strip("/")
    name = str(file.get("name") or "").strip("/")
    if not name or path.endswith(name):
        return path or name
    return f"{path}/{name}" if path else name


class DeveloperStudioAgent:
    """Real capability today: `stream_generated_files(...)`. Future
    capabilities are documented stubs below — see module docstring."""

    # -----------------------------------------------------------------
    # Real, working capability
    # -----------------------------------------------------------------
    @staticmethod
    async def stream_generated_files(project_id: int, agent_type: str, files: list[dict]) -> None:
        """Broadcasts already-generated file content in small paced chunks so
        Development Studio can render it as if it were typing in live. Never
        raises — wrapped so a streaming hiccup never fails the calling agent."""
        try:
            await manager.code_gen_started(project_id, {"agent_type": agent_type, "total_files": len(files)})

            lines_per_chunk = 3
            chunk_delay_seconds = 0.035
            max_seconds_per_file = 4.0
            total_lines = 0

            for file in files:
                content = str(file.get("content") or "")
                lines = content.split("\n")
                total_lines += len(lines)
                file_start = asyncio.get_event_loop().time()

                i = 0
                while i < len(lines):
                    over_budget = (asyncio.get_event_loop().time() - file_start) > max_seconds_per_file
                    chunk_lines = lines[i:] if over_budget else lines[i : i + lines_per_chunk]
                    is_first = i == 0
                    is_last = over_budget or (i + lines_per_chunk) >= len(lines)

                    await manager.code_chunk(project_id, {
                        "agent_type": agent_type,
                        "file_path": resolve_full_path(file),
                        "language": file.get("language") or "text",
                        "chunk": "\n".join(chunk_lines),
                        "is_first_chunk": is_first,
                        "is_last_chunk": is_last,
                    })

                    if is_last:
                        break
                    await asyncio.sleep(chunk_delay_seconds)
                    i += lines_per_chunk

            await manager.code_gen_completed(project_id, {
                "agent_type": agent_type, "file_count": len(files), "lines_of_code": total_lines,
            })
        except Exception as exc:
            logger.warning("[DeveloperStudioAgent] code streaming failed for project %s (%s): %s", project_id, agent_type, exc)

    # -----------------------------------------------------------------
    # Future capabilities (not yet wired into the pipeline)
    # -----------------------------------------------------------------
    @staticmethod
    def resolve_dependency_conflicts(frontend_files: list[dict], backend_files: list[dict]) -> dict:
        """Detect and resolve conflicting package/library versions between
        the Frontend and Backend Agents' generated dependency manifests
        (package.json, requirements.txt, etc.)."""
        raise NotImplementedError("DeveloperStudioAgent.resolve_dependency_conflicts is not yet implemented")

    @staticmethod
    def merge_frontend_backend(frontend_files: list[dict], backend_files: list[dict]) -> dict:
        """Merge the Frontend and Backend Agents' generated file sets into a
        single coherent project layout (e.g. resolving where the frontend
        build output is served from relative to the backend app)."""
        raise NotImplementedError("DeveloperStudioAgent.merge_frontend_backend is not yet implemented")

    @staticmethod
    def assemble_project(project_id: int) -> dict:
        """Assemble every generated artifact for a project into a single,
        downloadable/runnable project tree on disk."""
        raise NotImplementedError("DeveloperStudioAgent.assemble_project is not yet implemented")

    @staticmethod
    def verify_build(project_id: int) -> dict:
        """Run the assembled project's real build step (e.g. `npm run build`,
        `pip install -r requirements.txt`) and report success/failure with
        captured output."""
        raise NotImplementedError("DeveloperStudioAgent.verify_build is not yet implemented")

    @staticmethod
    def verify_compile(project_id: int) -> dict:
        """Run a compile/type-check pass (e.g. `tsc --noEmit`, `python -m py_compile`)
        over the assembled project and report the first real error, if any."""
        raise NotImplementedError("DeveloperStudioAgent.verify_compile is not yet implemented")

    @staticmethod
    def detect_file_conflicts(files: list[dict]) -> list[dict]:
        """Detect two generated files that resolve to the same path with
        different content (a real collision, not just the path/name
        ambiguity `resolve_full_path` already handles)."""
        raise NotImplementedError("DeveloperStudioAgent.detect_file_conflicts is not yet implemented")

    @staticmethod
    def validate_architecture_consistency(project_id: int) -> dict:
        """Cross-check the Frontend/Backend Agents' generated code against
        the Solution Architect Agent's approved architecture (tech stack,
        module boundaries) and flag drift."""
        raise NotImplementedError("DeveloperStudioAgent.validate_architecture_consistency is not yet implemented")

    @staticmethod
    def review_generated_code(project_id: int, files: list[dict]) -> dict:
        """Run an automated quality pass over freshly generated code (this is
        a distinct, code-specific review from the standalone Review Agent's
        artefact scoring -- see agents/review/)."""
        raise NotImplementedError("DeveloperStudioAgent.review_generated_code is not yet implemented")

    @staticmethod
    def synchronize_workspace(project_id: int) -> dict:
        """Reconcile the live Development Studio workspace view with the
        latest persisted GeneratedArtifact rows (e.g. after an out-of-band
        edit or a resumed pipeline run)."""
        raise NotImplementedError("DeveloperStudioAgent.synchronize_workspace is not yet implemented")
