"""
models.py — database engine/session setup, the 10 ORM models from Section 3
of the PDF (with real Foreign Key relationships), and the Pydantic schemas
used by main.py for request/response validation.

Two deliberate, documented deviations from the literal column list in the
PDF (both are functional necessities, not scope creep):

  1. users.hashed_password — Section 3 lists no credential column for
     `users`. POST /auth/login has nothing to verify a password against
     without one, so it's added here.

  2. POST /ingestion/upload requires a `project_id` — see schema/endpoint
     note below; a `documents` row cannot exist without one.
"""
import enum
import os
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

# ---------------------------------------------------------------------------
# Database engine / session
# ---------------------------------------------------------------------------
def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


for env_path in (
    Path(__file__).resolve().parent / ".env",
    Path(__file__).resolve().parents[1] / ".env",
):
    _load_env_file(env_path)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://postgres:postgres@localhost:5432/ey_sdlc_studio",
)

engine_options = {"pool_pre_ping": True, "echo": False}
engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency — yields a request-scoped DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Enums (shared by ORM columns below and the Pydantic schemas)
# ---------------------------------------------------------------------------
class UserRole(str, enum.Enum):
    ADMIN = "admin"
    DEVELOPER = "developer"
    APPROVER = "approver"
    VIEWER = "viewer"


class ProjectType(str, enum.Enum):
    DOCUMENT_DRIVEN = "document_driven"
    STANDALONE_AI_GENERATION = "standalone_ai_generation"
    PROJECT_BASED_SDLC = "project_based_sdlc"


class ExecutionMode(str, enum.Enum):
    AUTONOMOUS = "autonomous"
    ASSISTED = "assisted"


class BuildType(str, enum.Enum):
    FULL_STACK = "full_stack"
    FRONTEND_ONLY = "frontend_only"
    BACKEND_ONLY = "backend_only"


class ProjectStatus(str, enum.Enum):
    DRAFT = "draft"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    ARCHIVED = "archived"


class DocumentType(str, enum.Enum):
    BRD = "BRD"
    RFP = "RFP"
    PDF = "PDF"
    DOCX = "DOCX"


class DeliverableType(str, enum.Enum):
    BRD = "BRD"
    SRS = "SRS"
    USER_STORIES = "User Stories"
    ARCHITECTURE_DOCUMENTS = "Architecture Documents"
    DATABASE_DOCUMENTS = "Database Documents"
    API_DOCUMENTS = "API Documents"
    TEST_REPORTS = "Test Reports"
    DEPLOYMENT_DOCUMENTS = "Deployment Documents"


class RunStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class AgentName(str, enum.Enum):

    MEMORY_AGENT = "Memory Agent"

    REQUIREMENT_AGENT = "Requirement Agent"

    BUSINESS_ANALYST_AGENT = "Business Analyst Agent"

    REVIEW_1 = "Human Review 1"

    SOLUTION_ARCHITECT_AGENT = "Solution Architect Agent"

    DATABASE_AGENT = "Database Design Agent"

    UIUX_AGENT = "UI/UX Design Agent"

    SECURITY_AGENT = "Security Architect Agent"

    COMPLIANCE_AGENT = "Compliance Architect Agent"

    REVIEW_2 = "Human Review 2"
    PRESENTATION_VIDEO_AGENT = "Presentation video agent"

    FRONTEND_AGENT = "Frontend Agent"

    BACKEND_AGENT = "Backend Agent"

    CODE_REVIEW_AGENT = "Code Review Agent"

    TESTING_AGENT = "Testing Agent"

    DOCUMENTATION_AGENT = "Documentation Agent"

    DEVOPS_AGENT = "DevOps Agent"

    DEPLOYMENT_AGENT = "Deployment Agent"

    MONITORING_AGENT = "Monitoring Agent"


class ApprovalStatus(str, enum.Enum):
    DRAFT_GENERATED = "Draft Generated"
    PENDING_APPROVAL = "Pending Approval"
    APPROVED = "Approved"
    REJECTED = "Rejected"
    PUBLISHED = "Published"


class ProviderName(str, enum.Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"
    AZURE_OPENAI = "azure_openai"
    AWS_BEDROCK = "aws_bedrock"
    OLLAMA = "ollama"


class ArtifactType(str, enum.Enum):
    REQUIREMENTS_DOC = "requirements_doc"
    USER_STORIES = "user_stories"
    ARCHITECTURE_DIAGRAM = "architecture_diagram"
    SQL_SCHEMA = "sql_schema"
    API_DESIGN = "api_design"
    REACT_CODE = "react_code"
    BACKEND_CODE = "backend_code"
    UIUX_DESIGN = "uiux_design"
    SECURITY_REPORT = "security_report"
    COMPLIANCE_REPORT = "compliance_report"
    DOCUMENTATION = "documentation"
    PRESENTATION       = "presentation"
    PRESENTATION_PPTX  = "presentation_pptx"

    # Human checkpoint artifacts (used as approval gates)
    REVIEW_1_CHECKPOINT = "review_1_checkpoint"
    REVIEW_2_CHECKPOINT = "review_2_checkpoint"

    # Used by the review pipeline to store the (mock) reviewed API response
    API_RESPONSE_MOCK = "api_response_mock"


    TEST_REPORT = "test_report"
    DEPLOYMENT_DOC = "deployment_doc"

    # Presentation sub-artifacts (used by PresentationVideoAgent)
    PRESENTATION_DIRECTOR = "presentation_director"
    PRESENTATION_LOGIC = "presentation_logic"
    PRESENTATION_REVIEW = "presentation_review"


class ReviewType(str, enum.Enum):
    ARCHITECTURE = "architecture"
    DATABASE = "database"
    UI = "ui"
    CODE = "code"
    SECURITY = "security"


# ---------------------------------------------------------------------------
# ORM models — Section 3, all 10 tables
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default=UserRole.DEVELOPER.value, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    # Added — see module docstring. Required for login to function.
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)

    approvals_given: Mapped[list["Approval"]] = relationship(
        back_populates="approver", foreign_keys="Approval.approved_by"
    )


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    project_type: Mapped[str] = mapped_column(String(40), nullable=False)
    execution_mode: Mapped[str] = mapped_column(String(20), nullable=False)
    build_type: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default=ProjectStatus.DRAFT.value, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    documents: Mapped[list["Document"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    deliverables: Mapped[list["ProjectDeliverable"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    agent_runs: Mapped[list["AgentRun"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    timeline_events: Mapped[list["TimelineEvent"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    approvals: Mapped[list["Approval"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    provider_configurations: Mapped[list["ProviderConfiguration"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    generated_artifacts: Mapped[list["GeneratedArtifact"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    review_results: Mapped[list["ReviewResult"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    document_type: Mapped[str] = mapped_column(String(10), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    project: Mapped["Project"] = relationship(back_populates="documents")


class ProjectDeliverable(Base):
    __tablename__ = "project_deliverables"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    deliverable_type: Mapped[str] = mapped_column(String(40), nullable=False)
    selected: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default=RunStatus.PENDING.value, nullable=False)

    project: Mapped["Project"] = relationship(back_populates="deliverables")


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    agent_name: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default=RunStatus.PENDING.value, nullable=False)
    start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    output_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    project: Mapped["Project"] = relationship(back_populates="agent_runs")


class TimelineEvent(Base):
    __tablename__ = "timeline_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    stage: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default=RunStatus.PENDING.value, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    project: Mapped["Project"] = relationship(back_populates="timeline_events")


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    artifact_type: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default=ApprovalStatus.DRAFT_GENERATED.value, nullable=False)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    project: Mapped["Project"] = relationship(back_populates="approvals")
    approver: Mapped["User | None"] = relationship(back_populates="approvals_given", foreign_keys=[approved_by])


class ProviderConfiguration(Base):
    __tablename__ = "provider_configurations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    provider_name: Mapped[str] = mapped_column(String(20), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    encrypted_key: Mapped[str | None] = mapped_column(Text, nullable=True)  # Fernet ciphertext, never raw

    project: Mapped["Project"] = relationship(back_populates="provider_configurations")


class GeneratedArtifact(Base):
    __tablename__ = "generated_artifacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    artifact_type: Mapped[str] = mapped_column(String(40), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    project: Mapped["Project"] = relationship(back_populates="generated_artifacts")


class ReviewResult(Base):
    __tablename__ = "review_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    review_type: Mapped[str] = mapped_column(String(20), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    findings: Mapped[dict] = mapped_column(JSON, nullable=False)

    project: Mapped["Project"] = relationship(back_populates="review_results")


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------
class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    password: str = Field(min_length=8)
    role: UserRole = UserRole.DEVELOPER


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: EmailStr
    full_name: str
    role: str
    created_at: datetime


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ProjectCreate(BaseModel):
    project_name: str
    project_type: ProjectType
    execution_mode: ExecutionMode
    deliverables: list[DeliverableType] = Field(default_factory=list)
    build_type: BuildType
    providers: dict[ProviderName, str] = Field(
        default_factory=dict,
        description="provider name -> raw API key; encrypted before storage, never echoed back",
    )
    description: str | None = None
    manual_stages: list[str] = Field(default_factory=list)
    launch_mode: str | None = None
    build_profile: str | None = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: str | None
    project_type: str
    execution_mode: str
    build_type: str
    status: str
    created_at: datetime


class DocumentUploadResponse(BaseModel):
    document_id: int
    upload_status: str
    project_reference: int
    extracted_chars: int = 0


class AgentRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    agent_name: str
    status: str
    start_time: datetime | None
    end_time: datetime | None
    output_url: str | None


class TimelineEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    stage: str
    status: str
    timestamp: datetime


class DashboardTimelineResponse(BaseModel):
    project_id: int
    project_status: str
    timeline_events: list[TimelineEventOut]
    agent_runs: list[AgentRunOut]


class GeneratedArtifactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    artifact_type: str
    content: str
    created_at: datetime


class ProjectDeliverableOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    deliverable_type: str
    selected: bool
    status: str


class ProjectDeliverablesResponse(BaseModel):
    project_id: int
    deliverables: list[ProjectDeliverableOut]
    artifacts: list[GeneratedArtifactOut]
