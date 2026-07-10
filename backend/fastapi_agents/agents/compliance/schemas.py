"""
Schemas for the Compliance Agent. Relocated verbatim from
agents/compliance_agent.py as part of the agents/<name>/ architectural
refactor -- content unchanged.
"""
from __future__ import annotations

from pydantic import BaseModel


class ComplianceAssessment(BaseModel):
    standards: list[str]  # GDPR, HIPAA, SOC2, etc.
    gaps: list[str]
    recommendations: list[str]


class GovernanceControl(BaseModel):
    control: str
    framework: str  # ISO 27001, NIST, CIS, etc.
    requirement: str
    implementation: str


class AuditRequirement(BaseModel):
    requirement: str
    frequency: str  # daily, weekly, monthly, quarterly, annually
    evidence: str
    responsible: str


class DataRetentionPolicy(BaseModel):
    dataType: str
    retentionPeriod: str
    deletionMethod: str
    justification: str


class RiskAssessment(BaseModel):
    risk: str
    likelihood: str  # low, medium, high
    impact: str  # low, medium, high, critical
    mitigation: str
    owner: str


class ComplianceArchitectureOutput(BaseModel):
    complianceAssessment: ComplianceAssessment
    governanceControls: list[GovernanceControl]
    auditRequirements: list[AuditRequirement]
    dataRetentionPolicies: list[DataRetentionPolicy]
    riskAssessment: list[RiskAssessment]
