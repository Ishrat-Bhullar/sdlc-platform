"""
agents/registry.py
====================
AgentRegistry + AgentFactory — the only place in the platform that knows
how to construct any agent from its AgentName value. agent_runner.py's
dispatch() (see PipelineExecutor) is the only caller; this is what removes
the old `getattr(ai_service, "generate_x")` string-based dispatch entirely
in favor of real polymorphism: every agent class exposes the same
`.generate(db, project_id, context) -> dict` contract, so dispatch never
needs to know which concrete agent it's calling.

Only agents with a real pipeline "generate" stage are registered here.
Memory Agent and the Review-1/Review-2 human-checkpoint stages have no
agent class to dispatch to (agent_runner._AGENT_CONFIG's "generate": None
already reflects that today, unchanged by this refactor) — Memory Agent's
constructor also predates this convention (a raw `dsn` positional arg, not
`db`/`project_id`), so it deliberately isn't force-fit into this registry.
The standalone Review Agent (agents/review/) isn't dispatched through the
pipeline either — it's called directly by main_extension.py's five
/reviews/* routes via `ReviewAgent.review(...)`, a different method
entirely from `.generate(...)`.
"""
from __future__ import annotations

from ..models import AgentName
from .backend.agent import BackendAgent
from .business_analyst.agent import BusinessAnalystAgent
from .compliance.agent import ComplianceArchitectAgent
from .database.agent import DatabaseAgent
from .documentation.agent import DocumentationAgent
from .frontend.agent import FrontendAgent
from .presentation.agent import PresentationVideoAgent
from .requirements.agent import RequirementAgent
from .security.agent import SecurityArchitectAgent
from .solution_architect.agent import ArchitectAgent
from .testing.agent import TestingAgent
from .uiux.agent import UIUXDesignAgent


class AgentRegistry:
    """Maps each AgentName value to the agent class that implements its
    pipeline "generate" stage."""

    _REGISTRY: dict[str, type] = {
        AgentName.REQUIREMENT_AGENT.value: RequirementAgent,
        AgentName.BUSINESS_ANALYST_AGENT.value: BusinessAnalystAgent,
        AgentName.SOLUTION_ARCHITECT_AGENT.value: ArchitectAgent,
        AgentName.DATABASE_AGENT.value: DatabaseAgent,
        AgentName.UIUX_AGENT.value: UIUXDesignAgent,
        AgentName.SECURITY_AGENT.value: SecurityArchitectAgent,
        AgentName.COMPLIANCE_AGENT.value: ComplianceArchitectAgent,
        AgentName.PRESENTATION_VIDEO_AGENT.value: PresentationVideoAgent,
        AgentName.FRONTEND_AGENT.value: FrontendAgent,
        AgentName.BACKEND_AGENT.value: BackendAgent,
        AgentName.TESTING_AGENT.value: TestingAgent,
        AgentName.DOCUMENTATION_AGENT.value: DocumentationAgent,
    }

    @classmethod
    def get(cls, agent_name: str) -> type | None:
        return cls._REGISTRY.get(agent_name)

    @classmethod
    def all(cls) -> dict[str, type]:
        return dict(cls._REGISTRY)


class AgentFactory:
    """The only place that knows how to instantiate any agent."""

    @staticmethod
    def create(agent_name: str, db=None, project_id: int | None = None):
        """Returns a ready-to-call agent instance for `agent_name`, or None
        if this agent has no registered "generate" stage (Memory Agent, the
        Review-1/Review-2 checkpoints)."""
        agent_cls = AgentRegistry.get(agent_name)
        if agent_cls is None:
            return None
        return agent_cls(db=db, project_id=project_id)
