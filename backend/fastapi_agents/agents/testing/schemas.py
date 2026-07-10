"""
Schemas for the Testing Agent. Extracted verbatim from ai_service.py
(lines 1016-1042) as part of the agents/<name>/ architectural refactor --
content unchanged.
"""
from __future__ import annotations

from pydantic import BaseModel


class TestCaseSpec(BaseModel):
    id: str
    name: str
    target: str = ""
    scenario: str = ""
    expected_result: str = ""


class TestDataSpec(BaseModel):
    entity: str
    sample_payload: dict = {}
    purpose: str = ""


class TestPlanOutput(BaseModel):
    summary: str
    suites: list[str]
    status: str
    coverage_targets: dict[str, int]
    unit_tests: list[TestCaseSpec] = []
    integration_tests: list[TestCaseSpec] = []
    api_tests: list[TestCaseSpec] = []
    ui_tests: list[TestCaseSpec] = []
    performance_tests: list[TestCaseSpec] = []
    security_tests: list[TestCaseSpec] = []
    edge_cases: list[str] = []
    test_data: list[TestDataSpec] = []
