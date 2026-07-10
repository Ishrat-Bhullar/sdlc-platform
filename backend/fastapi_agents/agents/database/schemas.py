"""
Schemas for the Database Agent. Base shapes (Column, Relationship, Entity,
MigrationScript, SchemaChatOutput) relocated verbatim from agents/db_agent.py.
DatabaseSchemaOutput is extended to a superset per the Database Agent
consolidation: it keeps DatabaseAgent's entities/relationships/migrations
contract and adds back the richer deliverable fields the old inline
ai_service.py implementation produced (sql_ddl, scaling_strategy,
partitioning_recommendations, design_decisions, normalization_notes,
er_diagram, audit_tables, sample_data) so downstream consumers lose no
information now that DatabaseAgent is the only Database Agent
implementation in the project.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

SUPPORTED_DB_TYPES = {
    "PostgreSQL",
    "MySQL",
    "SQLite",
    "MongoDB",
}


class Column(BaseModel):
    """Represents a database table column configuration."""
    name: str
    data_type: str
    nullable: bool
    default_value: str | None = None
    description: str


class Relationship(BaseModel):
    """Represents data-link structural mappings between tables."""
    source_table: str
    target_table: str
    relation_type: str
    foreign_key: str


class Entity(BaseModel):
    """Represents an isolated structural database entity/table constraint map."""
    table_name: str
    columns: list[Column]
    primary_keys: list[str]
    unique_constraints: list[str]
    indexes: list[str]


class MigrationScript(BaseModel):
    """Represents migration script rollout and rollback actions execution lines."""
    version: str = Field(description="Schema version track indicator.")
    up: list[str]
    down: list[str]


class DesignDecision(BaseModel):
    decision: str
    rationale: str = ""


class DatabaseSchemaOutput(BaseModel):
    """Complete system database compilation schema output data model layer."""
    database_type: str
    entities: list[Entity]
    relationships: list[Relationship]
    migrations: MigrationScript
    # --- Enterprise deliverable fields (superset added during the Database
    # Agent consolidation — see module docstring) ---------------------------
    sql_ddl: str = ""
    scaling_strategy: str = ""
    partitioning_recommendations: str = ""
    design_decisions: list[DesignDecision] = []
    normalization_notes: str = ""
    er_diagram: str = ""
    audit_tables: list[str] = []
    sample_data: dict[str, list[dict]] = {}


class SchemaChatOutput(BaseModel):
    """Validates structural data model schemas for conversational analysis dialogues."""
    answer: str
    referenced_tables: list[str]
