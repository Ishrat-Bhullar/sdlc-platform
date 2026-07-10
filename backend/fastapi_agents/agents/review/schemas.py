"""
Schemas for the Review Agent. Extracted verbatim from ai_service.py
(lines 1165-1178) as part of the agents/<name>/ architectural refactor --
content unchanged.
"""
from __future__ import annotations

from pydantic import BaseModel


class ReviewFinding(BaseModel):
    severity: str = "info"
    category: str = ""
    description: str = ""
    recommendation: str = ""
    line_reference: str | None = None


class ReviewOutcome(BaseModel):
    score: float
    risk_level: str = "medium"
    summary: str = ""
    findings: list[ReviewFinding] = []
    recommendations: list[str] = []
