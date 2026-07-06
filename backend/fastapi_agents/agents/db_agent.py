from __future__ import annotations

import json
import os
from pydantic import BaseModel, Field
from .llm_service import LLMService
from .ba_agent import BusinessAnalystOutput


# ==========================================================
# Supported Database Dialects Configuration
# ==========================================================

SUPPORTED_DB_TYPES = {
    "PostgreSQL",
    "MySQL",
    "SQLite",
    "MongoDB"
}


# ==========================================================
# Data Models (Validated Contracts for Prompt Architecture)
# ==========================================================

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


class DatabaseSchemaOutput(BaseModel):
    """Complete system database compilation schema output data model layer."""
    database_type: str
    entities: list[Entity]
    relationships: list[Relationship]
    migrations: MigrationScript


class SchemaChatOutput(BaseModel):
    """Validates structural data model schemas for conversational analysis dialogues."""
    answer: str
    referenced_tables: list[str]


# ==========================================================
# Utilities & Prompt File Handlers
# ==========================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def load_prompt(file_name: str) -> str:
    """
    Retrieves system baseline prompt definitions from localized workspace paths.
    """
    prompt_path = os.path.join(BASE_DIR, "prompts", file_name)

    if not os.path.exists(prompt_path):
        raise FileNotFoundError(
            f"Required agent system instructions missing from targeted track path: {prompt_path}"
        )

    with open(prompt_path, "r", encoding="utf-8") as file:
        return file.read()


def build_schema_prompt(
    ba_output: BusinessAnalystOutput | dict,
    db_type: str
) -> str:
    """
    Assembles user prompt instruction payloads matching targeted database options.
    """
    payload = (
        ba_output.model_dump()
        if isinstance(ba_output, BaseModel)
        else ba_output
    )

    return f"""
Target Database Type: {db_type}

Business Analyst Output:
{json.dumps(payload, indent=2)}

Generate:
1. Entities
2. Columns
3. Primary Keys
4. Unique Constraints
5. Indexes
6. Relationships
7. Migration Scripts (UP and DOWN)

Return valid JSON only.
"""


def build_schema_chat_prompt(
    schema_json: DatabaseSchemaOutput | dict,
    user_query: str
) -> str:
    """
    Formats contextual grounding data maps for relational design review discussions.
    """
    payload = (
        schema_json.model_dump()
        if isinstance(schema_json, BaseModel)
        else schema_json
    )

    return f"""
Database Schema:
{json.dumps(payload, indent=2)}

User Query:
{user_query}

Answer based only on the schema.
Return JSON:
{{
    "answer": "string",
    "referenced_tables": ["table1"]
}}
"""


# ==========================================================
# Main Orchestration Database Agent Engine
# ==========================================================

class DatabaseAgent:
    """
    Orchestrates table definition generations, DDL compilation runs,
    and granular analysis dialogues using validated runtime schemas.
    """

    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="database")

    def generate_schema_and_migrations(
        self,
        ba_output: BusinessAnalystOutput | dict,
        db_type: str = "PostgreSQL"
    ) -> DatabaseSchemaOutput:
        """
        Translates upstream business user contexts directly into a database layout.
        """

        if not ba_output:
            raise ValueError("Upstream inputs and context components parameters cannot be null or empty.")

        if db_type not in SUPPORTED_DB_TYPES:
            raise ValueError(
                f"Requested database dialect translation targets unsupported by platform runtime options: {db_type}"
            )

        result = self.llm.generate_json(
            system=load_prompt("db_agent_generation_prompt.txt"),
            prompt=build_schema_prompt(
                ba_output=ba_output,
                db_type=db_type
            ),
            schema=DatabaseSchemaOutput,
        )

        if not isinstance(result, DatabaseSchemaOutput):
            raise ValueError("Operational parsing exception encountered: Result failed signature validations checks.")

        if not result.entities:
            raise ValueError("Runtime setup verification warnings: Engine produced zero target data tables.")

        return result

    def chat_with_schema(
        self,
        schema_json: DatabaseSchemaOutput | dict,
        user_query: str
    ) -> SchemaChatOutput:
        """
        Executes granular search validations over historical architecture profiles.
        """

        if not schema_json:
            raise ValueError("Target database architecture configurations contexts cannot be empty.")

        if not user_query.strip():
            raise ValueError("Input conversation user diagnostic string fields cannot be empty or blank.")

        result = self.llm.generate_json(
            system=load_prompt("db_agent_chat_prompt.txt"),
            prompt=build_schema_chat_prompt(
                schema_json=schema_json,
                user_query=user_query
            ),
            schema=SchemaChatOutput,
        )

        if not isinstance(result, SchemaChatOutput):
            raise ValueError("Operational parsing exception encountered: Result failed chat output signature checks.")

        return result
