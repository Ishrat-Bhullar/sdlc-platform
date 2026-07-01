from __future__ import annotations

import json
import os
import psycopg2
from psycopg2.extras import RealDictCursor, Json
from typing import Any


class StorageAgent:
    """
    Storage layer for Multi-Agent SDLC platform.

    Handles persistence of:
    - Projects
    - BA/RA/Agent JSON outputs (stored in JSONB)
    """

    def __init__(self, dsn: str | None = None):
        self.dsn = dsn or os.getenv(
            "DATABASE_URL",
            "dbname=ey_sdlc_studio user=postgres password=postgres host=localhost port=5432"
        )

        self.connection = psycopg2.connect(self.dsn)
        self.connection.autocommit = False  # safer for multi-step workflows

        self._initialize_database()

    # ---------------------------------------------------------
    # DB SCHEMA INITIALIZATION
    # ---------------------------------------------------------
    def _initialize_database(self) -> None:
        with self.connection.cursor() as cursor:

            # Projects table
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """)

            # Agent artifacts table (BA / RA / QA etc.)
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS agent_artifacts (
                id SERIAL PRIMARY KEY,
                project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                agent_name VARCHAR(50) NOT NULL,
                version INTEGER DEFAULT 1,
                output JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """)

            # Index for performance (IMPORTANT for scale)
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """)

            cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_agent_project
            ON agent_artifacts(project_id);
            """)

            cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_agent_output_gin
            ON agent_artifacts USING GIN (output);
            """)

            self.connection.commit()

    # ---------------------------------------------------------
    # PROJECT CREATION
    # ---------------------------------------------------------
    def create_project(self, name: str, description: str = "") -> int:
        try:
            with self.connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO projects (name, description)
                    VALUES (%s, %s)
                    RETURNING id;
                    """,
                    (name, description)
                )
                project_id = cursor.fetchone()[0]
                self.connection.commit()
                return project_id

        except Exception:
            self.connection.rollback()
            raise

    # ---------------------------------------------------------
    # SAVE AGENT OUTPUT (BA / RA / QA / DEV etc.)
    # ---------------------------------------------------------
    def save_agent_output(
        self,
        project_id: int,
        agent_name: str,
        payload: dict[str, Any],
        version: int = 1
    ) -> int:

        try:
            with self.connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO agent_artifacts 
                    (project_id, agent_name, version, output)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id;
                    """,
                    (project_id, agent_name, version, Json(payload))
                )

                artifact_id = cursor.fetchone()[0]
                self.connection.commit()
                return artifact_id

        except Exception:
            self.connection.rollback()
            raise

    # ---------------------------------------------------------
    # FETCH FULL PROJECT WORKSPACE
    # ---------------------------------------------------------
    def get_project_workspace(self, project_id: int) -> dict[str, Any]:
        workspace_data: dict[str, Any] = {}

        with self.connection.cursor(cursor_factory=RealDictCursor) as cursor:

            # Project info
            cursor.execute(
                "SELECT * FROM projects WHERE id = %s;",
                (project_id,)
            )
            project = cursor.fetchone()
            workspace_data["project"] = dict(project) if project else {}

            # All agent outputs
            cursor.execute(
                """
                SELECT * FROM agent_artifacts
                WHERE project_id = %s
                ORDER BY created_at ASC;
                """,
                (project_id,)
            )

            rows = cursor.fetchall()
            workspace_data["agent_outputs"] = [
                dict(row) for row in rows
            ]

        return workspace_data

    # ---------------------------------------------------------
    # CLOSE CONNECTION
    # ---------------------------------------------------------
    def close(self) -> None:
        if self.connection:
            self.connection.close()


# ============================================================
# TEST PIPELINE (LOCAL VALIDATION)
# ============================================================
if __name__ == "__main__":

    print("Testing Multi-Agent Storage Layer...")

    try:
        storage = StorageAgent()

        # Create project
        pid = storage.create_project(
            name="EY AI SDLC Platform",
            description="Multi-agent SDLC workflow system"
        )

        # Mock BA output
        ba_output = {
            "epics": [
                {
                    "id": "EPIC-1",
                    "name": "Authentication",
                    "description": "Login and access control system"
                }
            ],
            "user_stories": [
                {
                    "id": "US-1",
                    "epic_id": "EPIC-1",
                    "story": "As a user, I want to log in",
                    "priority": "Must",
                    "acceptance_criteria": [
                        {
                            "given": "User on login page",
                            "when": "Valid credentials entered",
                            "then": "Redirect to dashboard"
                        }
                    ]
                }
            ],
            "stakeholders": ["User", "Product Owner"]
        }

        # Save BA output using generic agent system
        artifact_id = storage.save_agent_output(
            project_id=pid,
            agent_name="BA_AGENT",
            payload=ba_output,
            version=1
        )

        print(f"\n[SUCCESS] Stored agent output ID: {artifact_id}")

        # Fetch full workspace
        result = storage.get_project_workspace(pid)

        print("\n[WORKSPACE DATA]")
        print(json.dumps(result, indent=2, default=str))

        storage.close()

    except Exception as e:
        print(f"\n[ERROR]: {e}")
        print("Ensure PostgreSQL is running and database 'ey_sdlc_studio' exists.")