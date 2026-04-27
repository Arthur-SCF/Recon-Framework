# Contributing

## Prerequisites

- Docker + Docker Compose
- Node 22+ (frontend dev)
- Python 3.13+ (backend dev)

## Development Setup

```bash
# Clone
git clone https://github.com/Kyrielles/RECON_APP.git
cd RECON_APP

# Copy env template
cp .env.example .env
# Edit .env — set RECON_MASTER_KEY and ENCRYPTION_SALT

# Start with dev overrides (hot-reload, no read-only FS)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Or run backend locally (faster iteration)
pip install -r requirements.txt
uvicorn engine.app:app --reload --port 8000

# Frontend dev server
cd frontend && npm install && npm run dev
```

## Project Structure

```
engine/          FastAPI backend
  api/           14 API routers
  pipeline/      Pipeline engine + STEP_REGISTRY
  db.py          SQLite async wrapper
  crypto.py      Fernet encryption helpers
  config.py      Pydantic settings
frontend/src/    React + TypeScript
  pages/         5 top-level pages
  components/    Shared components
  hooks/         Custom React hooks
migrations/      SQLite migration files (001–NNN)
docker/          Dockerfiles + nginx config
scripts/         Build scripts (wordlists, etc.)
```

## Adding a Pipeline Step

1. Create `engine/pipeline/tools/your_tool.py` — subclass `BaseTool` or `BaseAction`
2. Register it in `engine/pipeline/registry.py` under `STEP_REGISTRY`
3. Add it to the default template in `engine/pipeline/templates.py`
4. Add a new migration in `migrations/` if new DB tables are needed

See `engine/pipeline/tools/subfinder.py` as a reference implementation.

## Database Migrations

**Never modify existing migration files.** Only add new numbered files:

```bash
# Next migration after 015
touch migrations/016_your_change.sql
```

## Code Style

- Python: type hints on all function signatures, parameterized SQL only, `shell=False` in all subprocess calls
- TypeScript: strict mode, no `any`, prefer named exports
- Commits: conventional commits format (`feat:`, `fix:`, `refactor:`, etc.)

## Security

- Report vulnerabilities privately via GitHub Security Advisories, not public issues
- All SQL must use `?` placeholders — no string interpolation
- All subprocess calls must use `shell=False` and validate input before passing to tools
- Secrets (API keys, tokens) must be Fernet-encrypted at rest via `engine/crypto.py`
