# EY Autonomous SDLC Studio — Deployment Setup Guide

This guide is derived entirely from the code in this repository (not generic instructions). It covers everything needed to clone, configure, and run the platform on a new machine, using your own Azure OpenAI or OpenAI API key.

**Architecture note before you start:** this repo contains two backends. The one that actually runs is the **Python/FastAPI backend** at `backend/fastapi_agents/` (port 8000). There is also a legacy Node/Express backend at `backend/src/` (with its own `package.json`, migrations, and seed script) — **it is dead code, not wired to the frontend at all**, and everything in this guide ignores it. Do not run `npm start` inside `backend/`.

---

## 1. System Requirements

| Component | Version | Why |
|---|---|---|
| **Python** | 3.11.x (the committed `venv/` was built with 3.11.15) | `requirements.txt` and all backend code target 3.11. Not pinned in a `pyproject.toml`/`runtime.txt` — there is no hard technical block on 3.12, but 3.11 is what this codebase has actually been run on. |
| **Node.js** | 20.x LTS (or any `^18.0.0 \|\| >=20.0.0`) | This is Vite's own `engines` constraint (`frontend/node_modules/vite/package.json`). Node 19/21-odd or anything below 18 is unsupported by Vite 5.4. |
| **npm** | 9+ (ships with Node 20) | No explicit npm pin in `frontend/package.json`. |
| **PostgreSQL** | 14+ | **Required — not optional.** `DATABASE_URL` defaults to a Postgres DSN (`backend/fastapi_agents/models.py:64-67`) and there is no SQLite code path anywhere in this codebase. Tables are auto-created on startup (see §6), but the **database itself** must exist first. |
| **Ollama** | Not required | Only used as the last-resort fallback in the provider chain (§5) when no cloud key is configured. Since your senior is bringing his own Azure/OpenAI key, he will never hit this path. Skip it. |
| **FFmpeg + ffprobe** | Required only for the Presentation/Video Generation feature | Checked via `shutil.which("ffmpeg")` in `video_pipeline_local.py` and `services/video_composer.py`; every other agent (Requirements, BA, Architecture, Database, UI/UX, Security, Compliance, Documentation) works with zero FFmpeg dependency. If skipped, the core SDLC pipeline is unaffected — only the video stage will fail with a clear "ffmpeg is not installed" error. |
| **LibreOffice (`soffice`)** | Optional, video pipeline only | Used to rasterize the generated `.pptx` deck into slide images for video rendering (`video_pipeline_local.py:1295`, override via `SOFFICE_BIN`). Falls back gracefully if absent. |
| **Poppler (`pdftoppm`)** | Optional, video pipeline only | PDF-to-image fallback path in the same slide-rasterization step (`video_pipeline_local.py:1348`). |
| **espeak-ng** | Optional, video pipeline only | Third-tier TTS fallback (after edge-tts and macOS `say`) — `video_pipeline_local.py:1262`. Not needed on macOS (uses `say`); needed on Linux only if you also want offline narration with no internet access. |

**Not required, despite files existing in the repo:**
- `gfpgan/weights/*.pth` (~289MB of model weights at repo root) — only used by the optional SadTalker "Human Avatar" lip-sync presenter mode, which additionally needs `torch, torchvision, facexlib, gfpgan, kornia, face_alignment, yacs, pydub, basicsr` — **none of which are in `requirements.txt`**. Default video presenter modes (Cartoon / Voice Only / No Presenter) don't need any of this.
- `mmdc` (mermaid-cli) / PlantUML — referenced in `architect_diagram_tools.py` and `diagram_service.py`, but neither module is imported by any live route. The actual diagram generation (`diagram_generator.py`) is pure Python with no external tool dependency.
- Supabase — `frontend/src/lib/supabase.ts` exists and constructs a client, but nothing in the frontend imports or uses it. Dead code, ignore it.

---

## 2. Clone Repository

```bash
git clone <your-repo-url> SDLC
cd SDLC
```

---

## 3. Backend Setup

All commands below assume you're at the repo root (`SDLC/`).

```bash
# 1. Create the virtual environment (Python 3.11)
python3.11 -m venv venv

# 2. Activate it
source venv/bin/activate          # macOS/Linux
# venv\Scripts\activate            # Windows

# 3. Install backend dependencies (the ONLY requirements file is at repo root)
pip install -r requirements.txt
```

That installs: `fastapi`, `uvicorn[standard]`, `python-dotenv`, `sqlalchemy`, `psycopg2-binary`, `pydantic`, `PyJWT`, `passlib[bcrypt]`, `cryptography`, `python-multipart`, `email-validator`, `python-pptx`, `Pillow`, `pdf2image`, `requests`, `edge-tts`.

**No migrations to run.** There is no Alembic anywhere in this repo. Tables are created automatically the first time the app starts (`Base.metadata.create_all(bind=engine)` — `main.py:177`), including a manual additive-column shim for one table (`_ensure_provider_configuration_columns`) that handles minor schema changes without a real migration tool. You do not need to run any `create_all` or migration command yourself — starting the server is enough.

**Database creation (you must do this manually — the app does not create the database itself, only the tables inside it):**

```bash
# Using the psql CLI:
createdb ey_sdlc_studio
# or, if that user/role doesn't exist yet:
psql -U postgres -c "CREATE DATABASE ey_sdlc_studio;"
```

This must match whatever `DATABASE_URL` you set in `.env` (§4). The code's default assumes a local Postgres with user `postgres` / password `postgres` on `localhost:5432` — if your senior's local Postgres uses different credentials, he must set `DATABASE_URL` explicitly to match.

**Required folders:** none need to be created manually. `STORAGE_BASE_PATH` (default `./storage`, relative to wherever `uvicorn` is launched from) is auto-created on startup (`main.py:179`), and every subdirectory under it (per-project folders, diagram output, video work directories, etc.) is auto-created on demand by the relevant module. If you run `uvicorn` with `--app-dir backend` from the repo root (the documented way — see §7), `storage/` will be created at the repo root.

---

## 4. Environment Variables

**Read the actual code, not just `.env.example`** — the existing `backend/.env.example` is significantly out of date. Two of its variable names are flatly wrong and don't match any variable the code reads (`JWT_SECRET` should be `JWT_SECRET_KEY`; `FRONTEND_URL` should be `FRONTEND_URLS`, plural), `PORT` is declared but never read anywhere, and roughly 25 real environment variables the code depends on are missing from it entirely. The table below and the `.env.example` in §4.1 reflect what the code actually reads.

Create `backend/.env` (loaded explicitly by path in `main.py:44`, so it works regardless of the working directory `uvicorn` is launched from):

### Core / required

| Variable | Required? | Example | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | `postgresql+psycopg2://postgres:postgres@localhost:5432/ey_sdlc_studio` | Postgres connection string. Default in code matches this exact value — only set it if your local Postgres differs. |
| `DEMO_MODE` | Recommended: `false` | `false` | When `true`, bypasses password auth for one hardcoded email (`ishratbhullar@gmail.com`) and serves rich mock data instead of real LLM calls on any generation failure (see the codebase's `ai_service.py` module docstring). **Your senior should keep this `false`** so he's testing the real pipeline with his real key, not the demo fallback. |
| `JWT_SECRET_KEY` | Strongly recommended | `<32+ random chars>` | Signs access-token JWTs. If unset, a random secret is generated per process start — the server still runs, but every restart invalidates all existing sessions. Generate one with `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`. |
| `JWT_REFRESH_SECRET_KEY` | Strongly recommended | `<32+ random chars>` | Same as above but for refresh tokens. Must be a *different* value than `JWT_SECRET_KEY`. |
| `PROVIDER_KEY_ENCRYPTION_KEY` | Strongly recommended | `<Fernet key>` | Encrypts any per-project BYOK provider keys stored in the DB (`ProviderConfiguration` table). If unset, a random key is generated per process — any BYOK keys saved in one run become undecryptable after a restart. Generate with `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. |
| `COOKIE_SECURE` | No | `false` | Whether auth cookies get the `Secure` flag. Keep `false` for local HTTP development; set `true` only behind HTTPS. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | `30` | Access-token lifetime. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | No | `7` | Refresh-token lifetime. |
| `FRONTEND_URLS` | No | `http://localhost:5173,http://127.0.0.1:5173` | CORS allow-list. Default already includes `localhost:5173`/`127.0.0.1:5173`/`:3000` variants, so you don't need to set this unless the frontend runs on a non-default host/port. |
| `STORAGE_BASE_PATH` | No | `./storage` | Where uploaded documents, generated diagrams, and video work files are written. |

### AI Provider — set ONE of these tiers (see §5 for full explanation)

| Variable | Required? | Example | Used by |
|---|---|---|---|
| `DEFAULT_AZURE_OPENAI_API_KEY` | Only if using Azure | `abc123...` | Azure OpenAI |
| `DEFAULT_AZURE_OPENAI_ENDPOINT` | Only if using Azure (all 3 Azure vars must be set together) | `https://your-resource.openai.azure.com` | Azure OpenAI |
| `DEFAULT_AZURE_OPENAI_DEPLOYMENT` | Only if using Azure | `gpt-4o` | Azure OpenAI — this is your **deployment name**, not the base model name |
| `DEFAULT_AZURE_OPENAI_API_VERSION` | No (defaults to `2024-06-01`) | `2024-06-01` | Azure OpenAI |
| `DEFAULT_OPENAI_API_KEY` | Only if using OpenAI directly | `sk-...` | OpenAI |
| `DEFAULT_OPENAI_BASE_URL` | No (defaults to `https://api.openai.com/v1`) | `https://api.openai.com/v1` | OpenAI (or an OpenAI-compatible endpoint) |
| `DEFAULT_OPENAI_MODEL` | No (defaults to `gpt-4o-mini`) | `gpt-4o` | OpenAI |
| `GROQ_API_KEY` | No — leave blank if using Azure/OpenAI | | Groq (fast/cheap dev-tier provider, tried *before* OpenAI but *after* Azure — see §5) |
| `GROQ_BASE_URL` | No | `https://api.groq.com/openai/v1` | Groq |
| `GROQ_MODEL` | No (defaults to `llama-3.3-70b-versatile`) | `llama-3.3-70b-versatile` | Groq |

### Presentation Studio — hero images (optional, Azure OpenAI only)

| Variable | Required? | Example | Purpose |
|---|---|---|---|
| `AZURE_OPENAI_IMAGE_API_KEY` | No | | Enables AI-generated hero images on presentation slides. |
| `AZURE_OPENAI_IMAGE_ENDPOINT` | No | | Same feature. |
| `AZURE_OPENAI_IMAGE_DEPLOYMENT` | No | e.g. a `dall-e-3` or `gpt-image-1` deployment | Same feature. |
| `AZURE_OPENAI_IMAGE_API_VERSION` | No (defaults to `2024-04-01-preview`) | | Same feature. Leave all four blank to skip hero images — slides still render fully via gradients/icons/diagrams. |

### Video/Presentation pipeline internals (optional — only relevant if testing that specific feature)

| Variable | Required? | Purpose |
|---|---|---|
| `VIDEO_MODEL` | No | Selects video-generation backend variant; blank is fine for default local pipeline. |
| `VIDEO_PIPELINE_WORKDIR` | No (defaults to `./storage/video_work`) | Scratch directory for in-progress video renders. |
| `DISABLE_EDGE_TTS` | No | Set to `1` to force fully-offline narration (skips the free Microsoft edge-tts service, which needs outbound internet but no API key). |
| `D_ID_API_KEY` | No | Enables the D-ID "talking head" avatar provider; falls back to local SadTalker (if installed) or a static image otherwise. |
| `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` | No | Alternate TTS provider used by `services/video_generation_service.py`; not the default path. |
| `COQUI_TTS_MODEL` / `COQUI_SPEAKER_WAV` / `COQUI_DEFAULT_SPEAKER` | No | Alternate local TTS (Coqui) config; not the default path. |
| `SOFFICE_BIN` | No (defaults to `soffice`) | Override the LibreOffice binary name/path if it's not on `PATH` under that name. |
| `SADTALKER_TIMEOUT_SECONDS` / `SADTALKER_ENHANCER` | No | Only relevant if the optional SadTalker avatar mode is installed. |

### Ollama fallback (optional — irrelevant if a cloud key above is set)

| Variable | Required? | Purpose |
|---|---|---|
| `OLLAMA_BASE_URL` | No (defaults to `http://localhost:11434`) | Local Ollama server address. |
| `OLLAMA_MODEL` | No | Primary local model name. |
| `OLLAMA_MODEL_FALLBACKS` | No | Comma-separated fallback model chain. |
| `OLLAMA_AUTO_FALLBACK` | No (defaults `true`) | Whether to try the next model in the chain on failure. |
| `OLLAMA_TIMEOUT` | No (defaults `60`) | Per-request timeout in seconds. |

### Dead/no-op variables (present in the old `.env.example`, safe to delete)

`JWT_SECRET` (code reads `JWT_SECRET_KEY`), `PORT` (port is set via the uvicorn `--port` CLI flag, never read from env), `FRONTEND_URL` (code reads `FRONTEND_URLS`, plural).

### 4.1 Generated `.env.example`

Save this as `backend/.env.example`, replacing the current outdated one:

```env
# ── Core (required) ────────────────────────────────────────────────────────
DATABASE_URL=postgresql+psycopg2://postgres:postgres@localhost:5432/ey_sdlc_studio
DEMO_MODE=false

# Generate with: python3 -c "import secrets; print(secrets.token_urlsafe(48))"
JWT_SECRET_KEY=
JWT_REFRESH_SECRET_KEY=

# Generate with: python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
PROVIDER_KEY_ENCRYPTION_KEY=

COOKIE_SECURE=false
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
FRONTEND_URLS=http://localhost:5173,http://127.0.0.1:5173
STORAGE_BASE_PATH=./storage

# ── AI Provider (set ONE tier) ──────────────────────────────────────────────
# Resolution order: BYOK (per-project) -> Azure OpenAI -> Groq -> OpenAI -> Ollama.
# Leaving a tier's key blank makes the chain skip it automatically.

# Azure OpenAI — takes over from Groq the moment all three are set.
DEFAULT_AZURE_OPENAI_API_KEY=
DEFAULT_AZURE_OPENAI_ENDPOINT=
DEFAULT_AZURE_OPENAI_DEPLOYMENT=
DEFAULT_AZURE_OPENAI_API_VERSION=2024-06-01

# Groq — fast/cheap dev-tier provider, tried before OpenAI but after Azure.
GROQ_API_KEY=
GROQ_BASE_URL=
GROQ_MODEL=llama-3.3-70b-versatile

# OpenAI — tried only if Azure and Groq are both unconfigured/failed.
DEFAULT_OPENAI_API_KEY=
DEFAULT_OPENAI_BASE_URL=
DEFAULT_OPENAI_MODEL=gpt-4o-mini

# ── Presentation Studio image generation (Azure OpenAI only, optional) ─────
AZURE_OPENAI_IMAGE_API_KEY=
AZURE_OPENAI_IMAGE_ENDPOINT=
AZURE_OPENAI_IMAGE_DEPLOYMENT=
AZURE_OPENAI_IMAGE_API_VERSION=2024-04-01-preview

# ── Video/Presentation pipeline internals (optional) ───────────────────────
VIDEO_MODEL=
VIDEO_PIPELINE_WORKDIR=./storage/video_work
DISABLE_EDGE_TTS=
D_ID_API_KEY=
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
COQUI_TTS_MODEL=tts_models/multilingual/multi-dataset/xtts_v2
COQUI_SPEAKER_WAV=
COQUI_DEFAULT_SPEAKER=
SOFFICE_BIN=soffice
SADTALKER_TIMEOUT_SECONDS=
SADTALKER_ENHANCER=

# ── Ollama fallback (optional — irrelevant if a cloud key above is set) ───
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=
OLLAMA_MODEL_FALLBACKS=
OLLAMA_AUTO_FALLBACK=true
OLLAMA_TIMEOUT=60
```

---

## 5. AI Provider Setup

The entire provider selection logic lives in `backend/fastapi_agents/agents/llm_service.py`. Every single agent call in the platform (Requirements, BA, Architecture, Database, UI/UX, Security, Compliance, Documentation, AI Review) goes through this one module — nothing calls a provider SDK directly.

**Resolution order, tried in sequence for every LLM call** (`llm_service.py:9-26`, implemented in `_produce_text`):

1. **Per-project BYOK** — a key configured for that specific project via the "Provider Configurations" UI/API (`ProviderConfiguration` table), decrypted with `PROVIDER_KEY_ENCRYPTION_KEY`. Always wins if present.
2. **Azure OpenAI** (deployment-wide default) — used if `DEFAULT_AZURE_OPENAI_API_KEY`, `DEFAULT_AZURE_OPENAI_ENDPOINT`, and `DEFAULT_AZURE_OPENAI_DEPLOYMENT` are **all three** set (`default_azure_config_from_env`, `llm_service.py:150-164`). If any one of the three is missing, this tier is silently skipped, not partially used.
3. **Groq** (deployment-wide default) — used only if `GROQ_API_KEY` is set. This is a fast/cheap **dev-and-testing** tier that sits between Azure and OpenAI.
4. **OpenAI** (deployment-wide default) — used only if `DEFAULT_OPENAI_API_KEY` is set and Azure/Groq above didn't resolve or failed.
5. **Ollama** — final fallback, used transparently only when none of the above are configured (or all failed). Talks to `OLLAMA_BASE_URL` (default `http://localhost:11434`).

**Practical implication for your senior:** to use his own key, he only needs to set **one** tier's variables in `backend/.env` and leave the rest blank:

- **Azure OpenAI** — set `DEFAULT_AZURE_OPENAI_API_KEY`, `DEFAULT_AZURE_OPENAI_ENDPOINT`, `DEFAULT_AZURE_OPENAI_DEPLOYMENT` (his deployment name, e.g. `gpt-4o`).
- **OpenAI** — set `DEFAULT_OPENAI_API_KEY` only (and optionally `DEFAULT_OPENAI_MODEL` if not `gpt-4o-mini`).

No code changes are needed either way — this is 100% environment-variable-driven.

**One important exception:** the Presentation & Video Generation stage's underlying `PresentationVideoAgent` is **hard-locked to Azure OpenAI only** — it will not fall back to Groq/OpenAI/Ollama even if configured (`agent_runner.py`'s pipeline calls it with `provider_lock="azure_openai"`; see `llm_service.py:231-237`). If your senior uses OpenAI (not Azure), the core 8-agent SDLC pipeline (Requirements → Compliance) will work fully, but the Presentation/Video stage will fail with `"azure_openai is not configured (or failed) and this call is locked to azure_openai only"`. This is a **hard pipeline stop**: `agent_runner.py`'s `run_pipeline()` returns immediately on that failure and never proceeds to Frontend/Backend/Testing/Documentation, even though those stages don't need Azure at all. See §11 for the workaround.

---

## 6. Database Setup

- **Engine:** PostgreSQL only. There is no SQLite code path anywhere in this repository.
- **Required tables:** none need to be created by hand. Every table (`users`, `projects`, `agent_runs`, `approvals`, `generated_artifacts`, `timeline_events`, `documents`, `provider_configurations`, `review_results`, `project_deliverables`, plus one lazily-added `mcp_integrations` table) is created automatically via SQLAlchemy's `Base.metadata.create_all()`, called once at FastAPI startup (`main.py:177`, plus a second targeted call for the MCP table in `main_extension.py:1703`).
- **Migrations:** none exist (no Alembic). A small hand-written compatibility shim (`_ensure_provider_configuration_columns` in `models.py`) runs `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for 3 columns on `provider_configurations` at import time, to cover a schema change made after that table already existed in some deployments. You don't need to do anything for this — it runs automatically.
- **Seed data:** none for the Python backend. (There is a `backend/src/config/seed.js` — that belongs to the unused legacy Node backend; ignore it.)
- **First-run steps:**
  1. `createdb ey_sdlc_studio` (or match whatever DB name is in your `DATABASE_URL`).
  2. Start the backend (§7) — tables are created automatically on that first startup.
  3. Register a user via the frontend's Sign Up page, or `POST /auth/register` directly (see §9).

---

## 7. Backend Startup

From the repo root, with the venv activated and `backend/.env` in place:

```bash
python3.11 -m uvicorn fastapi_agents.main:app --app-dir backend --host 0.0.0.0 --port 8000
```

(This is the exact command in `.claude/launch.json`. `--reload` can be added for auto-restart on code changes during development.)

**Expected output:**
```
INFO:     Started server process [xxxxx]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```
You should also see one-time route-registration log lines from `presentation_integration`/`presentation_routes` confirming the presentation feature's routes loaded.

**URL:** `http://localhost:8000` (all endpoints are served at root — there is no `/api` prefix anywhere).

If you see `sdlc.demo` warning logs about `JWT_SECRET_KEY / PROVIDER_KEY_ENCRYPTION_KEY not set` at startup, go back and set those two in `.env` (§4) — the server will still run, but sessions won't survive a restart.

---

## 8. Frontend Setup

In a second terminal, from the repo root:

```bash
cd frontend
npm install
npm run dev
```

**Expected output:**
```
  VITE v5.4.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://<your-ip>:5173/
```

**URL:** `http://localhost:5173`

The frontend calls the backend directly at `http://localhost:8000` (from `frontend/.env`'s `VITE_API_BASE_URL`) — no dev-server proxy is involved for HTTP calls; only the WebSocket path (`/ws`) is proxied per `vite.config.ts`. If your senior runs the backend on a different host/port, he needs to update `frontend/.env`'s `VITE_API_BASE_URL` accordingly.

---

## 9. First Login

- **No default/seeded credentials exist** for a normal (`DEMO_MODE=false`) run — which is what your senior should use, since he wants to test with his own key.
- Go to `http://localhost:5173`, click **Sign In → Sign Up**, and register with:
  - Email (any valid-format address — nothing is verified/emailed)
  - Full name
  - Password (**minimum 8 characters** — enforced by `UserCreate.password: Field(min_length=8)` in `models.py`)
  - Role (defaults to `developer` if not specified)
- Auth is cookie-based JWT: on login, the backend sets `access_token` (short-lived, default 30 min) and `refresh_token` (default 7 days) as HttpOnly cookies. There's nothing to configure client-side beyond having the frontend and backend able to reach each other with credentials (already handled — CORS is configured with `allow_credentials=True`).
- If `DEMO_MODE=true` is set, logging in with the exact hardcoded email `ishratbhullar@gmail.com` bypasses password verification entirely and auto-creates that user. **Do not rely on this for your senior's test** — leave `DEMO_MODE=false` and have him register normally, so he's actually exercising the real auth path and his own AI key on real requests, not the demo shortcut.

---

## 10. Running the Platform

1. **Create a project:** click **"New Project"** on the Projects page (or use the prompt box on the landing page → "Start Autonomous Build"). Fill in project name, description, and the three required fields the backend expects (`project_type`, `execution_mode`, `build_type`) — the wizard UI sets sensible defaults for these; the important field is the free-text project description, since that's the context every downstream agent uses.

2. **Upload a BRD/PDF (optional):** from the landing page's upload control, or `POST /ingestion/upload` (multipart form: `project_id`, `document_type`, `file`). Supported text extraction: `.pdf` (via `pdfplumber`), `.docx`/`.doc` (via `python-docx`), `.txt`/`.md` (plain read). Uploaded files are stored under `storage/project_<id>/`.

3. **Start the workflow:** either click through individual "Generate X" actions per workspace page (Requirements, Business Analyst, Architecture, etc. — each hits its own `/generate/*` endpoint), or trigger the full 15-stage automated pipeline via the pipeline-trigger action, which runs: Memory → Requirements → Business Analyst → **Human Review 1** → Architecture → Database → UI/UX + Security (parallel) → Compliance → **Human Review 2** → Presentation/Video → Frontend → Backend → Testing → Documentation.

4. **Approve checkpoints:** the pipeline pauses at Human Review 1 (after Business Analyst) and Human Review 2 (after Compliance) and will not proceed on its own. Go to the **Approvals Center**, or use `POST /projects/{project_id}/approvals/{approval_id}/decide` with `{"decision": "Approved"}`. Approving either checkpoint automatically resumes the pipeline through all remaining stages — no separate "resume" action is needed.

5. **View artifacts:** each stage's output shows up in its matching workspace page in the left nav (Requirements, Business Analyst, Architecture, Database, UI/UX Design, Security, Compliance, Documentation) as soon as that stage completes — no manual refresh required if the page is already open (it polls/updates via the artifacts hook), otherwise click "Refresh" on the page.

---

## 11. Common Errors

| Symptom | Cause | Fix |
|---|---|---|
| Any `/generate/*` call returns **HTTP 502** with a message like `"... generation failed: ..."` | The configured AI provider rejected the request or returned unusable output (invalid key, wrong deployment name, model doesn't exist, network block) | Read the actual error text in the response `detail` field — it includes the underlying provider error. Double-check `DEFAULT_AZURE_OPENAI_DEPLOYMENT` is the **deployment name**, not the base model name (e.g. `gpt-4o`, not `gpt-4`). This is a real error surfaced on purpose — the platform will not silently substitute fake content for a failed AI call. |
| Backend fails to start with a Postgres connection error (`could not connect to server`, `password authentication failed`, etc.) | `DATABASE_URL` doesn't match a running, reachable Postgres instance, or the database named in it doesn't exist yet | Confirm Postgres is running (`pg_isready`), confirm the database exists (`createdb ey_sdlc_studio`), and confirm the user/password/host/port in `DATABASE_URL` are correct for your local Postgres install. |
| `Address already in use` on port 8000 or 5173 | Another process (often a previous uvicorn/vite instance that didn't shut down) is already bound to that port | `lsof -ti:8000 \| xargs kill` (or `:5173` for the frontend), then restart. Or change the port via the uvicorn `--port` flag / Vite's `server.port` in `vite.config.ts`. |
| Presentation/Video stage fails with `"azure_openai is not configured (or failed) and this call is locked to azure_openai only"` | That stage is hard-locked to Azure OpenAI regardless of what other provider is configured (§5) | Either configure `DEFAULT_AZURE_OPENAI_*` (even alongside OpenAI/Groq as the primary tier for everything else), or accept that this one stage will fail and manually re-trigger Frontend/Backend/Testing/Documentation individually afterward (the automated pipeline does **not** continue past a failed stage — see §5). |
| Video/Presentation render fails with `"ffmpeg is not installed or not on PATH"` | FFmpeg isn't installed | `brew install ffmpeg` (macOS) or `apt install ffmpeg` (Linux). Not required for any other agent. |
| `ModuleNotFoundError` for something like `psycopg2`, `fastapi`, `edge_tts`, etc. | Backend dependencies not installed, or installed into the wrong Python environment | Confirm the venv is activated (`which python` should point inside `venv/`) and re-run `pip install -r requirements.txt` from the repo root. |
| `npm ERR!` about a missing package, or the frontend won't start | `node_modules` not installed or corrupted | `cd frontend && rm -rf node_modules package-lock.json && npm install`. |
| Backend logs a warning about `JWT_SECRET_KEY / PROVIDER_KEY_ENCRYPTION_KEY not set` | Those two env vars are blank in `.env` | Not fatal — the server still runs with a random ephemeral secret — but set them (§4) so sessions and any saved BYOK keys survive a restart. |
| Frontend shows `Failed to fetch` / network errors on every page | Backend isn't running, or `VITE_API_BASE_URL` in `frontend/.env` doesn't match where the backend is actually listening | Confirm the backend terminal shows `Uvicorn running on http://0.0.0.0:8000`, and that `frontend/.env`'s `VITE_API_BASE_URL` is `http://localhost:8000`. |
| Login/register returns 401/400 unexpectedly | Wrong password, or trying to register an email that already exists | `/auth/register` returns 400 "A user with that email already exists" if you retry with the same email — just log in instead. |

---

## 12. Verification Checklist

- [ ] `createdb ey_sdlc_studio` succeeded (or your custom DB name/`DATABASE_URL` matches)
- [ ] `backend/.env` created with `DATABASE_URL`, `JWT_SECRET_KEY`, `JWT_REFRESH_SECRET_KEY`, `PROVIDER_KEY_ENCRYPTION_KEY`, and one AI provider tier (Azure or OpenAI) filled in
- [ ] Backend running — `uvicorn` shows `Application startup complete` on `http://0.0.0.0:8000`, no Postgres connection errors
- [ ] Frontend running — `npm run dev` shows `Local: http://localhost:5173/`
- [ ] Sign-up works — new account created via the Sign Up form (or `POST /auth/register` returns 201)
- [ ] Login works — session cookie set, redirected into the app shell
- [ ] Project creation works — new project appears in Projects / Recent Projects
- [ ] Requirements generate — real, project-specific content (not a generic banking-portal example) appears under Requirements workspace
- [ ] Business Analyst / User Stories generate — epics and stories specific to the project description appear
- [ ] Architecture generates — summary, tech stack, and a rendered diagram appear under Architecture workspace
- [ ] Database generates — tables/relationships specific to the project appear under Database workspace
- [ ] UI/UX generates — screens/user flows/wireframes appear under UI/UX Design workspace
- [ ] Security generates — threat model/controls appear under Security workspace
- [ ] Compliance generates — standards/governance controls appear under Compliance workspace
- [ ] Documentation generates — deliverables list appears under Documentation Center
- [ ] Approval workflow resumes correctly — approving the Human Review 1 checkpoint automatically starts Architecture (and onward) without any manual per-stage trigger; approving Human Review 2 automatically starts the Presentation/Frontend/Backend/Testing/Documentation stages (subject to the Azure-lock caveat in §5/§11)

---

## 13. Final Notes

**Modules that intentionally remain preview/demo — not wired to a real backend agent, or explicitly not yet implemented.** These show a "Preview — Planned Functionality" badge in the UI and are expected to display static/sample data, not real AI output:

- **Development Studio**
- **Monitoring Center**
- **Agent Control Center**
- **Frontend Workspace / Backend Workspace / Testing Workspace** — these three *do* call real backend generation endpoints, but that generation still falls back to canned mock output on any failure (unlike the 10 core agents above, which now surface real errors instead). Treat their output as illustrative, not production-validated.

**Known, not-yet-fixed issue to flag to your senior directly, since it will visibly affect a demo:** the "AI Review Copilot" floating chat button in the bottom-right corner of the UI is currently a hardcoded, scripted chat widget with **zero connection to the backend** — clicking through it will show canned text regardless of the project. The real backend review endpoints (`POST /reviews/{type}`) work correctly if called directly, but nothing in the UI currently calls them.

**One architectural gap worth knowing about before a live demo:** if only an OpenAI (not Azure) key is configured, the automated end-to-end pipeline will run Requirements through Compliance successfully, then hard-stop at the Presentation/Video stage (which requires Azure specifically) and never reach Frontend/Backend/Testing/Documentation automatically. See §5 and §11 for the exact behavior and workaround.

---

## Repository Improvements Required Before Handover

These are gaps in the repo itself — not things a new developer can work around, but things that should be fixed so the *next* person doesn't have to reverse-engineer them the way this guide did:

1. **`backend/.env.example` is out of date and actively misleading.** `JWT_SECRET` and `FRONTEND_URL` are the wrong variable names entirely (code reads `JWT_SECRET_KEY` and `FRONTEND_URLS`) — anyone following the old file would set a variable that does nothing. `PORT` is declared but never read anywhere. ~25 real, code-read environment variables are missing from it entirely (`JWT_REFRESH_SECRET_KEY`, `PROVIDER_KEY_ENCRYPTION_KEY`, `COOKIE_SECURE`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS`, `STORAGE_BASE_PATH`, the entire Ollama block, the entire video/avatar/TTS block, `MERMAID_CLI`/`PLANTUML_*`). Replace it with the `.env.example` generated in §4.1 of this guide.
2. **No `README.md` setup section** — the current `README.md` is feature/marketing copy with no install instructions at all. Link this `SETUP_GUIDE.md` from it.
3. **No Python version pin** (`pyproject.toml`/`runtime.txt`) — a new developer has no way to know 3.11 is expected without inspecting the committed `venv/pyvenv.cfg`, which most clones won't even have (it's arguably a local artifact that shouldn't be in version control at all — check whether `venv/` is `.gitignore`d).
4. **No `frontend/.env.example`** — the real `frontend/.env` exists and works, but there's nothing documenting what `VITE_API_BASE_URL` should be for a new environment.
5. **Dead code left in place with no warning label:** the entire `backend/src/` Express/Node backend (with its own working migrations and seed script) looks like a live, maintained alternative backend to anyone browsing the repo, but is completely unused. Same for `frontend/src/lib/supabase.ts`, `architect_diagram_tools.py`, and `diagram_service.py`. Either delete these or add a top-of-file comment explaining they're unused.
6. **The AI Review Copilot UI widget is disconnected from its own backend** — either wire it to the real `/reviews/{type}` endpoints or remove/hide it, since right now it actively misrepresents what the platform does in a demo.
