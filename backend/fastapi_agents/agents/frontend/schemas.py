"""
Schemas for the Frontend Agent. Extracted verbatim from ai_service.py
(lines 736-812) as part of the agents/<name>/ architectural refactor --
content unchanged. CodeFileSpec is also imported by the Backend Agent
(shared file-representation shape), so it stays defined here as the single
source of truth.
"""
from __future__ import annotations

from pydantic import BaseModel


class ComponentSpec(BaseModel):
    name: str
    type: str = "component"  # page | layout | shared | hook
    responsibility: str = ""
    props: list[str] = []
    children: list[str] = []


class RouteSpec(BaseModel):
    path: str
    component: str = ""
    guarded: bool = False
    description: str = ""


class StateStore(BaseModel):
    name: str
    shape: str = ""
    purpose: str = ""


class StateManagementPlan(BaseModel):
    approach: str = ""
    rationale: str = ""
    stores: list[StateStore] = []


class ApiIntegrationItem(BaseModel):
    endpoint: str
    method: str = "GET"
    hook_name: str = ""
    error_handling: str = ""
    loading_state: str = ""


class FormField(BaseModel):
    name: str
    type: str = "text"
    validation: str = ""


class FormSpec(BaseModel):
    name: str
    fields: list[FormField] = []
    submit_behavior: str = ""


class ReusableComponentSpec(BaseModel):
    name: str
    purpose: str = ""
    props: list[str] = []
    variants: list[str] = []


class CodeFileSpec(BaseModel):
    """A single real, complete generated source file — not a path string.
    Shared by the frontend and backend plans; matches the frontend's
    CodeFile type (types/unified.ts) exactly so Development Studio and the
    live preview can consume it with no further mapping."""
    path: str
    name: str
    content: str
    language: str = ""


class FrontendPlanOutput(BaseModel):
    framework: str
    files: list[CodeFileSpec] = []
    implementation: str
    folder_structure: list[str] = []
    component_architecture: list[ComponentSpec] = []
    routing: list[RouteSpec] = []
    state_management: StateManagementPlan = StateManagementPlan()
    api_integration_plan: list[ApiIntegrationItem] = []
    forms: list[FormSpec] = []
    error_handling: list[str] = []
    reusable_components: list[ReusableComponentSpec] = []
