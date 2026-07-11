"""
logging_config.py
==================
Centralized logging for the SDLC platform. Every agent module and
agent_runner.py get their logger from `get_logger(__name__)` here instead of
wiring up their own handlers, so the whole platform logs through one
configuration: console + a rotating logs/sdlc.log file.

`configure_logging()` is idempotent — safe to call from multiple entrypoints
(main.py at startup, a test, a standalone script) without attaching
duplicate handlers.
"""
from __future__ import annotations

import logging
import logging.handlers
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_FILE = LOG_DIR / "sdlc.log"

_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"

_configured = False


def configure_logging(level: int = logging.INFO) -> None:
    global _configured
    if _configured:
        return

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter(_FORMAT)

    root = logging.getLogger()
    root.setLevel(level)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    root.addHandler(console_handler)

    file_handler = logging.handlers.RotatingFileHandler(
        LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)

    _configured = True


def get_logger(name: str) -> logging.Logger:
    """Shared logger factory used by every agent and pipeline module.
    Configures the root logger on first use so importing a module directly
    (a script, a test) still logs to console + logs/sdlc.log even if
    main.py's startup never ran."""
    configure_logging()
    return logging.getLogger(name)
