"""
Schemas for the Developer Studio Agent. Currently empty: today's real
capability (streaming already-generated files to the UI) is pure broadcast
logic with no structured LLM output, so there is nothing to model yet.
Present so the folder shape matches every other agent; the future
capabilities documented in agent.py (dependency-conflict resolution,
build/compile verification, etc.) will each get a real schema here once
they're implemented, not before.
"""
from __future__ import annotations
