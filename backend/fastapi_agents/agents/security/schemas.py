"""
Schemas for the Security Agent. Relocated verbatim from
agents/security_agent.py as part of the agents/<name>/ architectural
refactor -- content unchanged.
"""
from __future__ import annotations

from pydantic import BaseModel


class SecurityArchitecture(BaseModel):
    layers: list[str]
    controls: list[str]
    patterns: list[str]


class Threat(BaseModel):
    threat: str
    impact: str  # low, medium, high, critical
    likelihood: str  # low, medium, high
    mitigation: str


class Authentication(BaseModel):
    strategy: str
    providers: list[str]
    mfa: bool
    sessionManagement: str


class Authorization(BaseModel):
    model: str  # RBAC, ABAC, etc.
    roles: list[str]
    permissions: list[str]
    policies: list[str]


class SecurityControl(BaseModel):
    control: str
    category: str  # authentication, encryption, monitoring, etc.
    implementation: str


class SecurityArchitectureOutput(BaseModel):
    securityArchitecture: SecurityArchitecture
    threatModel: list[Threat]
    authentication: Authentication
    authorization: Authorization
    securityControls: list[SecurityControl]
    securityChecklist: list[str]
