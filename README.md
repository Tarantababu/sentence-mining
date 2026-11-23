# Sentence Mining

Personalized error-driven language and memory engine. Paste a speaking-session log, map mistakes onto canonical learning units, update a deterministic forgetting curve, and practice a small i+1 study pack.

Architecture and schema: [docs/architecture.md](docs/architecture.md).

## Stack

- Backend: FastAPI, SQLAlchemy 2, Alembic, SQLite (Postgres-ready)
- Frontend: React, TypeScript, Vite, Tailwind CSS
- Tests: pytest

OpenAI is optional. Without `OPENAI_API_KEY` the app uses verified regex parsing and template cards. Core math (`S_k`, `p_k`, urgency, selection) is pure Python.

## Quick start

```bash
cp .env.example .env
# SEED_SAMPLE_DATA=true fills a sample session on first boot
./scripts/run-local.sh
```

API: http://127.0.0.1:8000  
Docs: http://127.0.0.1:8000/docs  
Health: http://127.0.0.1:8000/api/health

Frontend (second terminal):

```bash
cd frontend
npm install
npm run dev
```

UI: http://localhost:5173 — Vite proxies `/api` to the backend. With `SEED_SAMPLE_DATA=true` the practice player loads a seeded study pack so it is never empty.

Keyboard in the player: Enter checks / continues; `1` knew it, `2` shaky, `3` missed.

## Tests

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest
```

## Environment

See `.env.example`. Important keys:

| Key | Purpose |
| --- | --- |
| `DATABASE_URL` | `sqlite:///./sentence_mining.db` or `postgresql+psycopg://…` |
| `SEED_SAMPLE_DATA` | Seed one realistic session + study pack on empty boot |
| `OPENAI_API_KEY` | Optional enrichment + natural card phrasing |
| `OPENAI_MODEL` | Default `gpt-4o-mini` |

## API

- `POST /api/sessions/ingest`
- `GET /api/sessions` and `GET /api/sessions/{id}`
- `GET /api/study-pack/latest`
- `POST /api/study-pack/generate` optional `{ due_only, stretch_only }`
- `POST /api/reviews/submit` body: `{ "card_id", "result": "knew_it"|"shaky"|"missed" }`
- `GET /api/units` (`due_count`, ranked queue)
- `GET /api/health`

## Hosted web app

The Cursor-hosted player lives in `web/`: Next.js UI plus the same `/api/*` contract and memory math, reading `OPENAI_API_KEY` from the server environment (never `VITE_` / the browser). Locally it uses in-memory PGlite when `DATABASE_URL` is unset.

```bash
cd web
npm install
env -u DATABASE_URL npm run dev
```

UI: http://127.0.0.1:3000

Publish as a **private** app so OpenAI spend is not a public endpoint. Bind `OPENAI_API_KEY` in Cursor secrets; the app falls back to deterministic templates when the key is missing.

## Production

```bash
export DATABASE_URL=postgresql+psycopg://user:pass@host:5432/sentence_mining
export SEED_SAMPLE_DATA=false
./scripts/run-prod.sh
```

Schema stays on portable SQLAlchemy types (no SQLite-only columns). Run `alembic upgrade head` from `backend/` (the prod script does this).
