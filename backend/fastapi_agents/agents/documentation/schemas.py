"""
Schemas for the Documentation Agent. Extracted verbatim from ai_service.py
(lines 1093-1115) as part of the agents/<name>/ architectural refactor --
content unchanged.
"""
from __future__ import annotations

from pydantic import BaseModel


class TroubleshootingItem(BaseModel):
    issue: str
    symptoms: str = ""
    resolution: str = ""


class FAQItem(BaseModel):
    question: str
    answer: str = ""


class DocumentationPlanOutput(BaseModel):
    documents: list[str]
    format: str
    status: str
    developer_guide: str = ""
    deployment_guide: str = ""
    installation_guide: str = ""
    api_documentation: str = ""
    operations_guide: str = ""
    maintenance_guide: str = ""
    troubleshooting: list[TroubleshootingItem] = []
    faqs: list[FAQItem] = []
