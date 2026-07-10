"""
Schemas for the Backend Agent. Extracted verbatim from ai_service.py
(lines 688-961: API-design result + backend build-plan schemas) as part of
the agents/<name>/ architectural refactor -- content unchanged.
"""
from __future__ import annotations

from pydantic import BaseModel

from ..frontend.schemas import CodeFileSpec


class ApiEndpoint(BaseModel):
    method: str
    path: str
    description: str = ""
    request_body: str | None = None
    response: str = ""
    auth_required: bool = True


class ApiDesignResult(BaseModel):
    api_style: str = "REST"
    base_url: str = "/api/v1"
    endpoints: list[ApiEndpoint] = []
    authentication_strategy: str = ""
    rate_limiting: str = ""
    versioning_strategy: str = ""
    openapi_yaml: str = ""


class EndpointSpec(BaseModel):
    method: str
    path: str
    summary: str = ""
    request_schema: dict = {}
    response_schema: dict = {}
    status_codes: dict[str, str] = {}


class AuthSpec(BaseModel):
    strategy: str = ""
    token_type: str = ""
    session_handling: str = ""


class AuthzSpec(BaseModel):
    model: str = ""
    roles: list[str] = []
    permission_matrix: dict[str, list[str]] = {}


class ServiceSpec(BaseModel):
    name: str
    responsibility: str = ""
    methods: list[str] = []
    depends_on: list[str] = []


class RepositorySpec(BaseModel):
    name: str
    entity: str = ""
    methods: list[str] = []


class ExceptionHandlingSpec(BaseModel):
    exception_type: str
    http_status: str = ""
    handling_strategy: str = ""


class BackgroundJobSpec(BaseModel):
    name: str
    trigger: str = ""
    schedule: str = ""
    purpose: str = ""


class BackendPlanOutput(BaseModel):
    framework: str
    modules: list[str]
    implementation: str
    files: list[CodeFileSpec] = []
    api_specifications: list[EndpointSpec] = []
    authentication: AuthSpec = AuthSpec()
    authorization: AuthzSpec = AuthzSpec()
    service_layer: list[ServiceSpec] = []
    repository_layer: list[RepositorySpec] = []
    validation: list[str] = []
    exception_handling: list[ExceptionHandlingSpec] = []
    background_jobs: list[BackgroundJobSpec] = []
